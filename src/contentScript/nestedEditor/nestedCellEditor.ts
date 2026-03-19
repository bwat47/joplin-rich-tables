import type { ViewUpdate, EditorView } from '@codemirror/view';
import { setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import {
    activeCellSessionPlugin as nestedCellEditorPlugin,
    cleanupHostedActiveCellSessions,
    closeActiveCellSession,
    handleMainEditorSessionUpdate,
    isActiveCellSessionOpen,
    openActiveCellSession,
    refocusActiveCellSession,
} from './activeCellSession';
import { createActiveCellForTableText } from '../tableRuntime/activeCellFactory';
import { resolveActiveCell } from '../tableRuntime/activeCellResolver';
import { setPendingNavigationCallback } from '../tableRuntime/navigationLock';
import { getCanonicalTableTextIfChanged, normalizeBeforeEditAnnotation } from '../tableRuntime/tableNormalization';
import { rememberPendingCellOpen } from './pendingCellOpen';
import { requestOpenActiveCellEffect } from '../tableRuntime/activeCellOpen';

export { nestedCellEditorPlugin };

/**
 * Lifecycle-internal gate for opening the nested editor.
 * Other runtime modules should dispatch active-cell state plus open intent and
 * let nestedEditorLifecycle.ts call this function.
 */
export function openNestedCellEditor(params: {
    mainView: EditorView;
    cellElement: HTMLElement;
    activeCell: ActiveCell;
    normalizeIfNeeded?: boolean;
    initialCursorPos?: 'start' | 'end';
    onFocused?: () => void;
}): void {
    if (params.normalizeIfNeeded) {
        const resolved = resolveActiveCell(params.mainView.state, params.activeCell);
        if (!resolved) {
            return;
        }

        const canonicalText = getCanonicalTableTextIfChanged(resolved.ctx);
        if (canonicalText) {
            const nextActiveCell = createActiveCellForTableText({
                tableFrom: resolved.tableFrom,
                tableText: canonicalText,
                target: params.activeCell,
            });
            if (!nextActiveCell) {
                return;
            }

            if (params.initialCursorPos) {
                rememberPendingCellOpen(params.mainView, nextActiveCell.activeCell, {
                    initialCursorPos: params.initialCursorPos,
                });
            }
            if (params.onFocused) {
                setPendingNavigationCallback(params.onFocused);
            }

            params.mainView.dispatch({
                changes: {
                    from: resolved.tableFrom,
                    to: resolved.tableTo,
                    insert: canonicalText,
                },
                selection: { anchor: nextActiveCell.selectionAnchor },
                effects: [
                    setActiveCellEffect.of(nextActiveCell.activeCell),
                    requestOpenActiveCellEffect.of({
                        activeCell: nextActiveCell.activeCell,
                        normalizeIfNeeded: false,
                    }),
                    rebuildTableWidgetsEffect.of({ tableFrom: resolved.tableFrom }),
                ],
                annotations: normalizeBeforeEditAnnotation.of(true),
                scrollIntoView: false,
            });
            return;
        }
    }

    openActiveCellSession({
        mainView: params.mainView,
        cellElement: params.cellElement,
        activeCell: params.activeCell,
        initialCursorPos: params.initialCursorPos,
        onFocused: params.onFocused,
    });
}

export function closeNestedCellEditor(view: EditorView, params?: { cellFrom?: number; cellTo?: number }): void {
    closeActiveCellSession(view, params);
}

export function isNestedCellEditorOpen(view: EditorView): boolean {
    return isActiveCellSessionOpen(view);
}

export function handleMainEditorUpdateForNestedEditor(view: EditorView, update: ViewUpdate): void {
    handleMainEditorSessionUpdate(view, update);
}

export function cleanupHostedEditors(view: EditorView, container: HTMLElement): void {
    cleanupHostedActiveCellSessions(view, container);
}

export function refocusNestedEditor(view: EditorView): void {
    refocusActiveCellSession(view);
}

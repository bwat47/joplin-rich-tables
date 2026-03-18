import { StateEffect, TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
    clearActiveCellEffect,
    getActiveCell,
    setActiveCellEffect,
    type ActiveCell,
} from '../tableState/activeCellState';
import { clearCellSelectionEffect, getCellSelection } from '../tableState/cellSelectionState';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { openNestedCellEditor, closeNestedCellEditor, isNestedCellEditorOpen } from '../nestedEditor/nestedCellEditor';
import { clearPendingCellOpen, rememberPendingCellOpen } from '../nestedEditor/pendingCellOpen';
import { createActiveCellForTableText } from './activeCellFactory';
import { releasePendingNavigationCallback, setPendingNavigationCallback } from './navigationLock';
import { resolveActiveCell } from './activeCellResolver';
import { getCanonicalTableTextIfChanged, normalizeBeforeEditAnnotation } from './tableNormalization';

export type ActiveCellSelectionPolicy = 'preserve' | 'clear';

export interface ActivateCellParams {
    activeCell: ActiveCell;
    cellElement: HTMLElement;
    selectionPolicy?: ActiveCellSelectionPolicy;
    normalizeIfNeeded?: boolean;
    initialCursorPos?: 'start' | 'end';
    onFocused?: () => void;
    selection?: TransactionSpec['selection'];
    scrollIntoView?: boolean;
}

export interface RetargetAfterTableRewriteParams {
    nextActiveCell: ActiveCell;
    changes?: TransactionSpec['changes'];
    selection?: TransactionSpec['selection'];
    annotations?: TransactionSpec['annotations'];
    scrollIntoView?: boolean;
    rebuildTableFrom?: number;
    selectionPolicy?: ActiveCellSelectionPolicy;
    initialCursorPos?: 'start' | 'end';
    onFocused?: () => void;
}

export interface ClearActiveCellParams {
    reason: string;
    closeNestedEditor?: boolean;
    clearPendingState?: boolean;
    clearSelection?: boolean;
    selection?: TransactionSpec['selection'];
    scrollIntoView?: boolean;
}

function normalizeEffects(effects?: TransactionSpec['effects']): readonly StateEffect<unknown>[] {
    if (!effects) {
        return [];
    }

    return (Array.isArray(effects) ? effects : [effects]) as readonly StateEffect<unknown>[];
}

function buildSelectionEffects(view: EditorView, selectionPolicy: ActiveCellSelectionPolicy): StateEffect<unknown>[] {
    if (selectionPolicy !== 'clear' || !getCellSelection(view.state)) {
        return [];
    }

    return [clearCellSelectionEffect.of(undefined)];
}

function rememberOpenMetadata(
    view: EditorView,
    activeCell: ActiveCell,
    params: { initialCursorPos?: 'start' | 'end'; onFocused?: () => void }
): void {
    rememberPendingCellOpen(view, activeCell, {
        initialCursorPos: params.initialCursorPos,
    });

    if (params.onFocused) {
        setPendingNavigationCallback(params.onFocused);
    }
}

function buildDispatchSpec(params: {
    activeCell: ActiveCell;
    view: EditorView;
    selectionPolicy: ActiveCellSelectionPolicy;
    changes?: TransactionSpec['changes'];
    selection?: TransactionSpec['selection'];
    annotations?: TransactionSpec['annotations'];
    scrollIntoView?: boolean;
    rebuildTableFrom?: number;
}): TransactionSpec {
    const effects: StateEffect<unknown>[] = [
        ...buildSelectionEffects(params.view, params.selectionPolicy),
        setActiveCellEffect.of(params.activeCell),
    ];

    if (params.rebuildTableFrom !== undefined) {
        effects.push(rebuildTableWidgetsEffect.of({ tableFrom: params.rebuildTableFrom }));
    }

    return {
        ...(params.changes ? { changes: params.changes } : {}),
        ...(params.selection !== undefined ? { selection: params.selection } : {}),
        ...(params.annotations !== undefined ? { annotations: params.annotations } : {}),
        effects,
        ...(params.scrollIntoView !== undefined ? { scrollIntoView: params.scrollIntoView } : {}),
    };
}

export function activateCell(view: EditorView, params: ActivateCellParams): boolean {
    const selectionPolicy = params.selectionPolicy ?? 'preserve';

    if (params.normalizeIfNeeded) {
        const resolved = resolveActiveCell(view.state, params.activeCell);
        if (!resolved) {
            return false;
        }

        const canonicalText = getCanonicalTableTextIfChanged(resolved.ctx);
        if (canonicalText) {
            const nextActiveCell = createActiveCellForTableText({
                tableFrom: resolved.tableFrom,
                tableText: canonicalText,
                target: params.activeCell,
            });
            if (!nextActiveCell) {
                return false;
            }

            rememberOpenMetadata(view, nextActiveCell, params);
            view.dispatch(
                buildDispatchSpec({
                    activeCell: nextActiveCell,
                    view,
                    changes: {
                        from: resolved.tableFrom,
                        to: resolved.tableTo,
                        insert: canonicalText,
                    },
                    selection: params.selection ?? { anchor: nextActiveCell.anchorPos },
                    annotations: normalizeBeforeEditAnnotation.of(true),
                    scrollIntoView: params.scrollIntoView ?? false,
                    rebuildTableFrom: resolved.tableFrom,
                    selectionPolicy,
                })
            );
            return true;
        }
    }

    view.dispatch(
        buildDispatchSpec({
            activeCell: params.activeCell,
            view,
            selection: params.selection,
            scrollIntoView: params.scrollIntoView,
            selectionPolicy,
        })
    );
    openNestedCellEditor({
        mainView: view,
        cellElement: params.cellElement,
        activeCell: params.activeCell,
        initialCursorPos: params.initialCursorPos,
        onFocused: params.onFocused,
    });
    return true;
}

export function retargetAfterTableRewrite(view: EditorView, params: RetargetAfterTableRewriteParams): void {
    rememberOpenMetadata(view, params.nextActiveCell, params);
    view.dispatch(
        buildDispatchSpec({
            activeCell: params.nextActiveCell,
            view,
            changes: params.changes,
            selection: params.selection,
            annotations: params.annotations,
            scrollIntoView: params.scrollIntoView,
            rebuildTableFrom: params.rebuildTableFrom,
            selectionPolicy: params.selectionPolicy ?? 'preserve',
        })
    );
}

export function buildClearActiveCellEffects(effects?: TransactionSpec['effects']): readonly StateEffect<unknown>[] {
    return [...normalizeEffects(effects), clearActiveCellEffect.of(undefined)];
}

export function withClearActiveCellEffect(spec: TransactionSpec = {}): TransactionSpec {
    return {
        ...spec,
        effects: buildClearActiveCellEffects(spec.effects),
    };
}

export function clearActiveCell(view: EditorView, params: ClearActiveCellParams): void {
    void params.reason;

    if (params.clearPendingState ?? true) {
        clearPendingCellOpen(view);
        releasePendingNavigationCallback();
    }

    if (params.closeNestedEditor && isNestedCellEditorOpen(view)) {
        closeNestedCellEditor(view);
    }

    const effects: StateEffect<unknown>[] = [];
    if (getActiveCell(view.state)) {
        effects.push(clearActiveCellEffect.of(undefined));
    }
    if (params.clearSelection && getCellSelection(view.state)) {
        effects.push(clearCellSelectionEffect.of(undefined));
    }

    if (effects.length === 0 && params.selection === undefined) {
        return;
    }

    view.dispatch({
        ...(params.selection !== undefined ? { selection: params.selection } : {}),
        ...(effects.length > 0 ? { effects } : {}),
        ...(params.scrollIntoView !== undefined ? { scrollIntoView: params.scrollIntoView } : {}),
    });
}

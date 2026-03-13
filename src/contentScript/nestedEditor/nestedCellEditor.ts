import type { ViewUpdate, EditorView } from '@codemirror/view';
import { getActiveCell } from '../tableWidget/activeCellState';
import { resolveActiveCell } from '../tableWidget/activeCellResolver';
import { findCellElement } from '../tableWidget/domHelpers';
import { isSourceModeEnabled } from '../tableWidget/sourceMode';
import { makeTableId } from '../tableModel/types';
import {
    activeCellSessionPlugin as nestedCellEditorPlugin,
    cleanupHostedActiveCellSessions,
    closeActiveCellSession,
    handleMainEditorSessionUpdate,
    isActiveCellSessionOpen,
    openActiveCellSession,
    refocusActiveCellSession,
} from './activeCellSession';
import { syncAnnotation } from './transactionPolicy';

export { nestedCellEditorPlugin, syncAnnotation };

export function openNestedCellEditor(params: {
    mainView: EditorView;
    cellElement: HTMLElement;
    cellFrom: number;
    cellTo: number;
    initialCursorPos?: 'start' | 'end';
    onFocused?: () => void;
}): void {
    const activeCell = getActiveCell(params.mainView.state);
    if (!activeCell) {
        return;
    }

    openActiveCellSession({
        mainView: params.mainView,
        cellElement: params.cellElement,
        activeCell,
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
    const activeCellBeforeCleanup = getActiveCell(view.state);
    const shouldAttemptRemount = Boolean(activeCellBeforeCleanup) && isNestedCellEditorOpen(view);

    cleanupHostedActiveCellSessions(view, container);

    if (!shouldAttemptRemount || isSourceModeEnabled(view.state)) {
        return;
    }

    requestAnimationFrame(() => {
        if (!view.dom.isConnected || isNestedCellEditorOpen(view)) {
            return;
        }

        const activeCell = getActiveCell(view.state);
        if (!activeCell) {
            return;
        }

        const resolvedActiveCell = resolveActiveCell(view.state, activeCell);
        if (!resolvedActiveCell) {
            return;
        }

        const cellElement = findCellElement(view, makeTableId(resolvedActiveCell.tableFrom), activeCell);
        if (!cellElement) {
            return;
        }

        openActiveCellSession({
            mainView: view,
            cellElement,
            activeCell,
        });
    });
}

export function refocusNestedEditor(view: EditorView): void {
    refocusActiveCellSession(view);
}

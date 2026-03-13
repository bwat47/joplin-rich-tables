import type { ViewUpdate, EditorView } from '@codemirror/view';
import { getActiveCell } from '../tableWidget/activeCellState';
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
    cleanupHostedActiveCellSessions(view, container);
}

export function refocusNestedEditor(view: EditorView): void {
    refocusActiveCellSession(view);
}

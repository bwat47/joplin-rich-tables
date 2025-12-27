import { EditorView } from '@codemirror/view';
import { clearActiveCellEffect, getActiveCell, ActiveCell } from '../tableWidget/activeCellState';
import { closeNestedCellEditor, isNestedCellEditorOpen } from '../nestedEditor/nestedCellEditor';
import { findTableRanges } from '../tableWidget/tablePositioning';
import { runTableOperation } from '../tableModel/tableTransactionHelpers';
import {
    insertRowForActiveCell,
    deleteRowForActiveCell,
    moveRowForActiveCell,
    moveColumnForActiveCell,
} from './tableCommandSemantics';
import { insertColumn, deleteColumn, updateColumnAlignment } from '../tableModel/markdownTableManipulation';

export type CommandColumnAlignment = 'left' | 'center' | 'right' | null;

/**
 * Editor control interface provided by Joplin
 */
interface EditorControl {
    editor: EditorView;
    cm6: EditorView;
    addExtension: (extension: unknown) => void;
    registerCommand: (name: string, callback: (...args: unknown[]) => unknown) => void;
}

// Reusable command implementations available to both Joplin commands and the floating toolbar

export function execInsertRowAbove(view: EditorView, cell: ActiveCell) {
    runTableOperation({
        view,
        cell,
        operation: (t, c) => insertRowForActiveCell(t, c, 'before'),
        computeTargetCell: (c) => {
            if (c.section === 'header') {
                return { section: 'header', row: 0, col: c.col };
            }
            return { section: 'body', row: c.row, col: c.col };
        },
        forceWidgetRebuild: true,
    });
}

export function execInsertRowBelow(view: EditorView, cell: ActiveCell) {
    runTableOperation({
        view,
        cell,
        operation: (t, c) => insertRowForActiveCell(t, c, 'after'),
        computeTargetCell: (c) => {
            if (c.section === 'header') {
                return { section: 'body', row: 0, col: c.col };
            }
            return { section: 'body', row: c.row + 1, col: c.col };
        },
        forceWidgetRebuild: true,
    });
}

export function execInsertColumnLeft(view: EditorView, cell: ActiveCell) {
    runTableOperation({
        view,
        cell,
        operation: (t, c) => insertColumn(t, c.col, 'before'),
        computeTargetCell: (c) => ({
            section: c.section,
            row: c.row,
            col: c.col,
        }),
        forceWidgetRebuild: true,
    });
}

export function execInsertColumnRight(view: EditorView, cell: ActiveCell) {
    runTableOperation({
        view,
        cell,
        operation: (t, c) => insertColumn(t, c.col, 'after'),
        computeTargetCell: (c) => ({
            section: c.section,
            row: c.row,
            col: c.col + 1,
        }),
        forceWidgetRebuild: true,
    });
}

export function execDeleteRow(view: EditorView, cell: ActiveCell) {
    runTableOperation({
        view,
        cell,
        operation: (t, c) => deleteRowForActiveCell(t, c),
        computeTargetCell: (c) => {
            if (c.section === 'header') {
                // Header row deleted, first body row promoted
                return { section: 'header', row: 0, col: c.col };
            }
            const newRow = Math.max(0, c.row - 1);
            return { section: 'body', row: newRow, col: c.col };
        },
        forceWidgetRebuild: true,
    });
}

export function execDeleteColumn(view: EditorView, cell: ActiveCell) {
    runTableOperation({
        view,
        cell,
        operation: (t, c) => deleteColumn(t, c.col),
        computeTargetCell: (c) => {
            const newCol = Math.max(0, c.col - 1);
            return { section: c.section, row: c.row, col: newCol };
        },
        forceWidgetRebuild: true,
    });
}

export function execUpdateAlignment(view: EditorView, cell: ActiveCell, align: CommandColumnAlignment) {
    runTableOperation({
        view,
        cell,
        operation: (t, c) => updateColumnAlignment(t, c.col, align),
        computeTargetCell: (c) => c,
        forceWidgetRebuild: true,
    });
}

export function execMoveRowUp(view: EditorView, cell: ActiveCell) {
    runTableOperation({
        view,
        cell,
        operation: (t, c) => moveRowForActiveCell(t, c, 'up'),
        computeTargetCell: (c) => {
            // If we are at the first body row (row 0) and move "up", we swap with header.
            // Our new position becomes the header.
            if (c.row === 0) {
                return { section: 'header', row: 0, col: c.col };
            }

            // Otherwise we just move up one row index
            return { section: 'body', row: c.row - 1, col: c.col };
        },
        forceWidgetRebuild: true,
    });
}

export function execMoveRowDown(view: EditorView, cell: ActiveCell) {
    runTableOperation({
        view,
        cell,
        operation: (t, c) => moveRowForActiveCell(t, c, 'down'),
        computeTargetCell: (c) => {
            // Follow the row to its new position.
            // Note: If the move is invalid (e.g. at bottom), the operation returns early
            // and this target calculation is never executed.

            if (c.section === 'header') {
                return { section: 'body', row: 0, col: c.col };
            }
            return { section: 'body', row: c.row + 1, col: c.col };
        },
        forceWidgetRebuild: true,
    });
}

export function execMoveColumnLeft(view: EditorView, cell: ActiveCell) {
    runTableOperation({
        view,
        cell,
        operation: (t, c) => moveColumnForActiveCell(t, c, 'left'),
        computeTargetCell: (c) => {
            return { ...c, col: c.col - 1 };
        },
        forceWidgetRebuild: true,
    });
}

export function execMoveColumnRight(view: EditorView, cell: ActiveCell) {
    runTableOperation({
        view,
        cell,
        operation: (t, c) => moveColumnForActiveCell(t, c, 'right'),
        computeTargetCell: (c) => {
            return { ...c, col: c.col + 1 };
        },
        forceWidgetRebuild: true,
    });
}

export function execFormatTable(view: EditorView, cell: ActiveCell) {
    runTableOperation({
        view,
        cell,
        // Return a shallow copy to bypass identity check and trigger re-serialization
        operation: (t) => ({ ...t }),
        computeTargetCell: (c) => c,
        forceWidgetRebuild: true,
    });
}

export function execInsertRowAtBottomAndFocusFirst(view: EditorView, cell: ActiveCell) {
    runTableOperation({
        view,
        cell,
        operation: (t, c) => insertRowForActiveCell(t, c, 'after'),
        computeTargetCell: (c) => {
            // New row is always body, and we want the first column
            if (c.section === 'header') {
                return { section: 'body', row: 0, col: 0 };
            }
            return { section: 'body', row: c.row + 1, col: 0 };
        },
        forceWidgetRebuild: true,
    });
}

export function registerTableCommands(editorControl: EditorControl): void {
    // Register command to close nested editor (called from plugin on note switch)
    editorControl.registerCommand('richTablesCloseNestedEditor', () => {
        const view = editorControl.cm6;
        if (isNestedCellEditorOpen(view)) {
            closeNestedCellEditor(view);
        }
        if (getActiveCell(view.state)) {
            view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
        }

        // Move cursor out of table if inside one (prevents showing raw markdown
        // when Joplin restores cursor position on note switch)
        const tables = findTableRanges(view.state);
        const cursor = view.state.selection.main.head;
        const tableContainingCursor = tables.find((t) => cursor >= t.from && cursor <= t.to);
        if (tableContainingCursor) {
            // Place cursor just after the table
            const newPos = Math.min(tableContainingCursor.to + 1, view.state.doc.length);
            view.dispatch({ selection: { anchor: newPos } });
        }

        return true;
    });

    // Register table manipulation commands
    editorControl.registerCommand('richTables.addRowAbove', () => {
        const cell = getActiveCell(editorControl.cm6.state);
        if (!cell) return false;
        execInsertRowAbove(editorControl.cm6, cell);
        return true;
    });

    editorControl.registerCommand('richTables.addRowBelow', () => {
        const cell = getActiveCell(editorControl.cm6.state);
        if (!cell) return false;
        execInsertRowBelow(editorControl.cm6, cell);
        return true;
    });

    editorControl.registerCommand('richTables.addColumnLeft', () => {
        const cell = getActiveCell(editorControl.cm6.state);
        if (!cell) return false;
        execInsertColumnLeft(editorControl.cm6, cell);
        return true;
    });

    editorControl.registerCommand('richTables.addColumnRight', () => {
        const cell = getActiveCell(editorControl.cm6.state);
        if (!cell) return false;
        execInsertColumnRight(editorControl.cm6, cell);
        return true;
    });

    editorControl.registerCommand('richTables.deleteRow', () => {
        const cell = getActiveCell(editorControl.cm6.state);
        if (!cell) return false;
        execDeleteRow(editorControl.cm6, cell);
        return true;
    });

    editorControl.registerCommand('richTables.deleteColumn', () => {
        const cell = getActiveCell(editorControl.cm6.state);
        if (!cell) return false;
        execDeleteColumn(editorControl.cm6, cell);
        return true;
    });

    editorControl.registerCommand('richTables.alignLeft', () => {
        const cell = getActiveCell(editorControl.cm6.state);
        if (!cell) return false;
        execUpdateAlignment(editorControl.cm6, cell, 'left');
        return true;
    });

    editorControl.registerCommand('richTables.alignRight', () => {
        const cell = getActiveCell(editorControl.cm6.state);
        if (!cell) return false;
        execUpdateAlignment(editorControl.cm6, cell, 'right');
        return true;
    });

    editorControl.registerCommand('richTables.alignCenter', () => {
        const cell = getActiveCell(editorControl.cm6.state);
        if (!cell) return false;
        execUpdateAlignment(editorControl.cm6, cell, 'center');
        return true;
    });

    editorControl.registerCommand('richTables.moveRowUp', () => {
        const cell = getActiveCell(editorControl.cm6.state);
        if (!cell) return false;
        execMoveRowUp(editorControl.cm6, cell);
        return true;
    });

    editorControl.registerCommand('richTables.moveRowDown', () => {
        const cell = getActiveCell(editorControl.cm6.state);
        if (!cell) return false;
        execMoveRowDown(editorControl.cm6, cell);
        return true;
    });

    editorControl.registerCommand('richTables.moveColumnLeft', () => {
        const cell = getActiveCell(editorControl.cm6.state);
        if (!cell) return false;
        execMoveColumnLeft(editorControl.cm6, cell);
        return true;
    });

    editorControl.registerCommand('richTables.moveColumnRight', () => {
        const cell = getActiveCell(editorControl.cm6.state);
        if (!cell) return false;
        execMoveColumnRight(editorControl.cm6, cell);
        return true;
    });
}

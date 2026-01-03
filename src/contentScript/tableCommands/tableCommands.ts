import { EditorView } from '@codemirror/view';
import { clearActiveCellEffect, getActiveCell, ActiveCell } from '../tableWidget/activeCellState';
import { toggleSourceMode } from '../tableWidget/sourceMode';
import { closeNestedCellEditor, isNestedCellEditorOpen } from '../nestedEditor/nestedCellEditor';

import { runTableOperation } from '../tableModel/tableTransactionHelpers';
import { activateTableCell } from '../tableWidget/cellActivation';
import {
    insertRowForActiveCell,
    deleteRowForActiveCell,
    moveRowForActiveCell,
    moveColumnForActiveCell,
} from './tableCommandSemantics';
import { insertColumn, deleteColumn, updateColumnAlignment } from '../tableModel/markdownTableManipulation';
import { TableData } from '../tableModel/markdownTableParsing';
import { TargetCell } from '../tableModel/activeCellForTableText';

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

// Helper to reduce boilerplate for standard table operations
function createTableCommand(
    operation: (table: TableData, cell: ActiveCell) => TableData,
    computeTargetCell: (cell: ActiveCell, oldTable: TableData, newTable: TableData) => TargetCell,
    forceWidgetRebuild: boolean = true
) {
    return (view: EditorView, cell: ActiveCell) => {
        runTableOperation({
            view,
            cell,
            operation,
            computeTargetCell,
            forceWidgetRebuild,
        });
    };
}

export const execInsertRowAbove = createTableCommand(
    (t, c) => insertRowForActiveCell(t, c, 'before'),
    (c) => {
        if (c.section === 'header') {
            return { section: 'header', row: 0, col: c.col };
        }
        return { section: 'body', row: c.row, col: c.col };
    }
);

export const execInsertRowBelow = createTableCommand(
    (t, c) => insertRowForActiveCell(t, c, 'after'),
    (c) => {
        if (c.section === 'header') {
            return { section: 'body', row: 0, col: c.col };
        }
        return { section: 'body', row: c.row + 1, col: c.col };
    }
);

export const execInsertColumnLeft = createTableCommand(
    (t, c) => insertColumn(t, c.col, 'before'),
    (c) => ({
        section: c.section,
        row: c.row,
        col: c.col,
    })
);

export const execInsertColumnRight = createTableCommand(
    (t, c) => insertColumn(t, c.col, 'after'),
    (c) => ({
        section: c.section,
        row: c.row,
        col: c.col + 1,
    })
);

export const execDeleteRow = createTableCommand(
    (t, c) => deleteRowForActiveCell(t, c),
    (c) => {
        if (c.section === 'header') {
            // Header row deleted, first body row promoted
            return { section: 'header', row: 0, col: c.col };
        }
        const newRow = Math.max(0, c.row - 1);
        return { section: 'body', row: newRow, col: c.col };
    }
);

export const execDeleteColumn = createTableCommand(
    (t, c) => deleteColumn(t, c.col),
    (c) => {
        const newCol = Math.max(0, c.col - 1);
        return { section: c.section, row: c.row, col: newCol };
    }
);

export const execMoveRowUp = createTableCommand(
    (t, c) => moveRowForActiveCell(t, c, 'up'),
    (c) => {
        // If we are at the first body row (row 0) and move "up", we swap with header.
        // Our new position becomes the header.
        if (c.row === 0) {
            return { section: 'header', row: 0, col: c.col };
        }

        // Otherwise we just move up one row index
        return { section: 'body', row: c.row - 1, col: c.col };
    }
);

export const execMoveRowDown = createTableCommand(
    (t, c) => moveRowForActiveCell(t, c, 'down'),
    (c) => {
        // Follow the row to its new position.
        // Note: If the move is invalid (e.g. at bottom), the operation returns early
        // and this target calculation is never executed.

        if (c.section === 'header') {
            return { section: 'body', row: 0, col: c.col };
        }
        return { section: 'body', row: c.row + 1, col: c.col };
    }
);

export const execMoveColumnLeft = createTableCommand(
    (t, c) => moveColumnForActiveCell(t, c, 'left'),
    (c) => {
        return { ...c, col: c.col - 1 };
    }
);

export const execMoveColumnRight = createTableCommand(
    (t, c) => moveColumnForActiveCell(t, c, 'right'),
    (c) => {
        return { ...c, col: c.col + 1 };
    }
);

export const execFormatTable = createTableCommand(
    // Return a shallow copy to bypass identity check and trigger re-serialization
    (t) => ({ ...t }),
    (c) => c
);

export function execUpdateAlignment(view: EditorView, cell: ActiveCell, align: CommandColumnAlignment) {
    runTableOperation({
        view,
        cell,
        operation: (t, c) => updateColumnAlignment(t, c.col, align),
        computeTargetCell: (c) => c,
        forceWidgetRebuild: true,
    });
}

export function execInsertRowAtBottom(view: EditorView, cell: ActiveCell, targetCol: number) {
    runTableOperation({
        view,
        cell,
        operation: (t, c) => insertRowForActiveCell(t, c, 'after'),
        computeTargetCell: (c) => {
            // New row is always body
            if (c.section === 'header') {
                return { section: 'body', row: 0, col: targetCol };
            }
            return { section: 'body', row: c.row + 1, col: targetCol };
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

        return true;
    });

    // Wrapper to reduce boilerplate for commands requiring an active cell
    const registerCellCommand = (name: string, action: (view: EditorView, cell: ActiveCell) => void) => {
        editorControl.registerCommand(name, () => {
            const cell = getActiveCell(editorControl.cm6.state);
            if (!cell) return false;
            action(editorControl.cm6, cell);
            return true;
        });
    };

    // Register table manipulation commands
    registerCellCommand('richTables.addRowAbove', execInsertRowAbove);
    registerCellCommand('richTables.addRowBelow', execInsertRowBelow);
    registerCellCommand('richTables.addColumnLeft', execInsertColumnLeft);
    registerCellCommand('richTables.addColumnRight', execInsertColumnRight);
    registerCellCommand('richTables.deleteRow', execDeleteRow);
    registerCellCommand('richTables.deleteColumn', execDeleteColumn);

    registerCellCommand('richTables.alignLeft', (v, c) => execUpdateAlignment(v, c, 'left'));
    registerCellCommand('richTables.alignRight', (v, c) => execUpdateAlignment(v, c, 'right'));
    registerCellCommand('richTables.alignCenter', (v, c) => execUpdateAlignment(v, c, 'center'));

    registerCellCommand('richTables.moveRowUp', execMoveRowUp);
    registerCellCommand('richTables.moveRowDown', execMoveRowDown);
    registerCellCommand('richTables.moveColumnLeft', execMoveColumnLeft);
    registerCellCommand('richTables.moveColumnRight', execMoveColumnRight);

    // Register insert table command that activates the first cell
    editorControl.registerCommand('richTables.insertTableAndActivate', () => {
        const view = editorControl.cm6;
        const cursorPos = view.state.selection.main.head;
        const tableMarkdown = '\n|  |  |\n| --- | --- |\n|  |  |\n';

        view.dispatch({
            changes: { from: cursorPos, insert: tableMarkdown },
            selection: { anchor: cursorPos + 3 }, // Position in first header cell (after "\n| ")
        });

        // Wait for widget to mount, then activate first header cell
        // Table starts at cursorPos + 1 (after leading newline)
        activateTableCell(view, cursorPos + 1, { section: 'header', row: 0, col: 0 });

        return true;
    });

    // Register source mode toggle command
    editorControl.registerCommand('richTables.toggleSourceMode', () => {
        return toggleSourceMode(editorControl.cm6);
    });
}

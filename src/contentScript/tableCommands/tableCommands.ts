import { EditorView } from '@codemirror/view';
import { getActiveCell, ActiveCell, clearActiveCellEffect } from '../tableWidget/activeCellState';
import { resolveActiveCell } from '../tableWidget/activeCellResolver';
import { toggleSourceMode } from '../tableWidget/sourceMode';
import { runTableOperation } from '../tableModel/tableTransactionHelpers';
import { activateTableCell } from '../tableWidget/cellActivation';
import { rebuildTableWidgetsEffect } from '../tableWidget/tableWidgetEffects';
import { MarkdownTable, type TableAlignment } from '../tableModel/MarkdownTable';
import { TargetCell } from '../tableModel/activeCellForTableText';

export type CommandColumnAlignment = TableAlignment;

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
    operation: (table: MarkdownTable, cell: ActiveCell) => MarkdownTable,
    computeTargetCell: (cell: ActiveCell, oldTable: MarkdownTable, newTable: MarkdownTable) => TargetCell,
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
    (t, c) => t.insertRowRelativeTo(c.section, c.row, 'before'),
    (c) => {
        if (c.section === 'header') {
            return { section: 'header', row: 0, col: c.col };
        }
        return { section: 'body', row: c.row, col: c.col };
    }
);

export const execInsertRowBelow = createTableCommand(
    (t, c) => t.insertRowRelativeTo(c.section, c.row, 'after'),
    (c) => {
        if (c.section === 'header') {
            return { section: 'body', row: 0, col: c.col };
        }
        return { section: 'body', row: c.row + 1, col: c.col };
    }
);

export const execInsertColumnLeft = createTableCommand(
    (t, c) => t.insertColumn(c.col, 'before'),
    (c) => ({
        section: c.section,
        row: c.row,
        col: c.col,
    })
);

export const execInsertColumnRight = createTableCommand(
    (t, c) => t.insertColumn(c.col, 'after'),
    (c) => ({
        section: c.section,
        row: c.row,
        col: c.col + 1,
    })
);

export const execDeleteRow = createTableCommand(
    (t, c) => t.deleteRowAt(c.section, c.row),
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
    (t, c) => t.deleteColumn(c.col),
    (c) => {
        const newCol = Math.max(0, c.col - 1);
        return { section: c.section, row: c.row, col: newCol };
    }
);

export const execMoveRowUp = createTableCommand(
    (t, c) => t.moveRow(c.section, c.row, 'up'),
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
    (t, c) => t.moveRow(c.section, c.row, 'down'),
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
    (t, c) => t.swapColumns(c.col, c.col - 1),
    (c) => {
        return { ...c, col: c.col - 1 };
    }
);

export const execMoveColumnRight = createTableCommand(
    (t, c) => t.swapColumns(c.col, c.col + 1),
    (c) => {
        return { ...c, col: c.col + 1 };
    }
);

export const execClearTable = createTableCommand(
    (t) => t.clearAllCells(),
    (c) => c
);

export const execClearRow = createTableCommand(
    (t, c) => t.clearRow(c.section, c.row),
    (c) => c
);

export const execClearColumn = createTableCommand(
    (t, c) => t.clearColumn(c.col),
    (c) => c
);

export function execDeleteTable(view: EditorView, cell: ActiveCell): void {
    const resolvedCell = resolveActiveCell(view.state, cell);
    if (!resolvedCell) {
        return;
    }

    view.dispatch({
        changes: { from: resolvedCell.tableFrom, to: resolvedCell.tableTo, insert: '' },
        effects: [
            clearActiveCellEffect.of(undefined),
            rebuildTableWidgetsEffect.of({ tableFrom: resolvedCell.tableFrom }),
        ],
    });
}

export function execUpdateAlignment(view: EditorView, cell: ActiveCell, align: CommandColumnAlignment) {
    runTableOperation({
        view,
        cell,
        operation: (t, c) => t.updateColumnAlignment(c.col, align),
        computeTargetCell: (c) => c,
        forceWidgetRebuild: true,
    });
}

export function execInsertRowAtBottom(view: EditorView, cell: ActiveCell, targetCol: number): boolean {
    return runTableOperation({
        view,
        cell,
        operation: (t, c) => t.insertRowRelativeTo(c.section, c.row, 'after'),
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

    registerCellCommand('richTables.clearRow', execClearRow);
    registerCellCommand('richTables.clearColumn', execClearColumn);
    registerCellCommand('richTables.clearTable', execClearTable);
    registerCellCommand('richTables.deleteTable', execDeleteTable);

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

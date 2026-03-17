import { EditorView } from '@codemirror/view';
import { clearActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { MarkdownTable, type TableAlignment } from '../tableModel/MarkdownTable';
import type { TargetCell } from '../tableModel/activeCellForTableText';
import { resolveActiveCell } from './activeCellResolver';
import { activateTableCell } from './cellActivation';
import { runTableOperation } from './runTableOperation';

export type CommandColumnAlignment = TableAlignment;

function createTableOperation(
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

export const execInsertRowAbove = createTableOperation(
    (t, c) => t.insertRowRelativeTo(c.section, c.row, 'before'),
    (c) =>
        c.section === 'header' ? { section: 'header', row: 0, col: c.col } : { section: 'body', row: c.row, col: c.col }
);

export const execInsertRowBelow = createTableOperation(
    (t, c) => t.insertRowRelativeTo(c.section, c.row, 'after'),
    (c) =>
        c.section === 'header'
            ? { section: 'body', row: 0, col: c.col }
            : { section: 'body', row: c.row + 1, col: c.col }
);

export const execInsertColumnLeft = createTableOperation(
    (t, c) => t.insertColumn(c.col, 'before'),
    (c) => ({ section: c.section, row: c.row, col: c.col })
);

export const execInsertColumnRight = createTableOperation(
    (t, c) => t.insertColumn(c.col, 'after'),
    (c) => ({ section: c.section, row: c.row, col: c.col + 1 })
);

export const execDeleteRow = createTableOperation(
    (t, c) => t.deleteRowAt(c.section, c.row),
    (c) =>
        c.section === 'header'
            ? { section: 'header', row: 0, col: c.col }
            : { section: 'body', row: Math.max(0, c.row - 1), col: c.col }
);

export const execDeleteColumn = createTableOperation(
    (t, c) => t.deleteColumn(c.col),
    (c) => ({ section: c.section, row: c.row, col: Math.max(0, c.col - 1) })
);

export const execMoveRowUp = createTableOperation(
    (t, c) => t.moveRow(c.section, c.row, 'up'),
    (c) => (c.row === 0 ? { section: 'header', row: 0, col: c.col } : { section: 'body', row: c.row - 1, col: c.col })
);

export const execMoveRowDown = createTableOperation(
    (t, c) => t.moveRow(c.section, c.row, 'down'),
    (c) =>
        c.section === 'header'
            ? { section: 'body', row: 0, col: c.col }
            : { section: 'body', row: c.row + 1, col: c.col }
);

export const execMoveColumnLeft = createTableOperation(
    (t, c) => t.swapColumns(c.col, c.col - 1),
    (c) => ({ ...c, col: c.col - 1 })
);

export const execMoveColumnRight = createTableOperation(
    (t, c) => t.swapColumns(c.col, c.col + 1),
    (c) => ({ ...c, col: c.col + 1 })
);

export const execClearTable = createTableOperation(
    (t) => t.clearAllCells(),
    (c) => c
);

export const execClearRow = createTableOperation(
    (t, c) => t.clearRow(c.section, c.row),
    (c) => c
);

export const execClearColumn = createTableOperation(
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

export function execUpdateAlignment(view: EditorView, cell: ActiveCell, align: CommandColumnAlignment): boolean {
    return runTableOperation({
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
        computeTargetCell: (c) =>
            c.section === 'header'
                ? { section: 'body', row: 0, col: targetCol }
                : { section: 'body', row: c.row + 1, col: targetCol },
        forceWidgetRebuild: true,
    });
}

export function insertTableAndActivate(view: EditorView): boolean {
    const cursorPos = view.state.selection.main.head;
    const tableMarkdown = '\n|  |  |\n| --- | --- |\n|  |  |\n';

    view.dispatch({
        changes: { from: cursorPos, insert: tableMarkdown },
        selection: { anchor: cursorPos + 3 },
    });

    activateTableCell(view, cursorPos + 1, { section: 'header', row: 0, col: 0 });
    return true;
}

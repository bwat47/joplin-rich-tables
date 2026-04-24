import { EditorView } from '@codemirror/view';
import { clearActiveCellEffect, type ActiveCell } from '../../tableState/activeCellState';
import { rebuildTableWidgetsEffect } from '../../tableState/tableWidgetEffects';
import { MarkdownTable, type TableAlignment } from '../../tableModel/MarkdownTable';
import type { TargetCell } from '../../tableModel/activeCellForTableText';
import { resolveActiveCell } from '../activeCell/resolvedActiveCell';
import { activateTableCell } from '../activeCell/cellActivation';
import { focusMainEditorWithoutScroll } from '../../shared/mainEditorFocus';
import { buildIsolatedRootTableInsertRewrite } from './rootTableInsertRewrite';
import { runStructuralMutationAndReopen, type StructuralReopenOptions } from './runStructuralMutation';

export type CommandColumnAlignment = TableAlignment;
export type RowInsertOpenOptions = StructuralReopenOptions;

const DEFAULT_INSERTED_TABLE_MARKDOWN = ['|  |  |', '| --- | --- |', '|  |  |'].join('\n');
const DEFAULT_INSERTED_TABLE_SELECTION_OFFSET = 2;

function sameCell(cell: ActiveCell): TargetCell {
    return cell;
}

function targetInsertedRowBefore(cell: ActiveCell): TargetCell {
    return cell.section === 'header'
        ? { section: 'header', row: 0, col: cell.col }
        : { section: 'body', row: cell.row, col: cell.col };
}

function targetInsertedRowAfter(cell: ActiveCell): TargetCell {
    return cell.section === 'header'
        ? { section: 'body', row: 0, col: cell.col }
        : { section: 'body', row: cell.row + 1, col: cell.col };
}

function targetInsertedRowAtBottom(cell: ActiveCell, targetCol: number): TargetCell {
    return cell.section === 'header'
        ? { section: 'body', row: 0, col: targetCol }
        : { section: 'body', row: cell.row + 1, col: targetCol };
}

function targetDeletedRow(cell: ActiveCell): TargetCell {
    return cell.section === 'header'
        ? { section: 'header', row: 0, col: cell.col }
        : { section: 'body', row: Math.max(0, cell.row - 1), col: cell.col };
}

function targetDeletedColumn(cell: ActiveCell): TargetCell {
    return { section: cell.section, row: cell.row, col: Math.max(0, cell.col - 1) };
}

function targetMovedRowUp(cell: ActiveCell): TargetCell {
    return cell.row === 0
        ? { section: 'header', row: 0, col: cell.col }
        : { section: 'body', row: cell.row - 1, col: cell.col };
}

function targetMovedRowDown(cell: ActiveCell): TargetCell {
    return cell.section === 'header'
        ? { section: 'body', row: 0, col: cell.col }
        : { section: 'body', row: cell.row + 1, col: cell.col };
}

export function getDefaultStructuralReopenOptions(view: EditorView): StructuralReopenOptions {
    return {
        afterDispatch: () => focusMainEditorWithoutScroll(view),
    };
}

export function getDefaultRowInsertOpenOptions(view: EditorView): RowInsertOpenOptions {
    return {
        ...getDefaultStructuralReopenOptions(view),
        initialCursorPos: 'start',
    };
}

function createReopeningStructuralOperation(
    operation: (table: MarkdownTable, cell: ActiveCell) => MarkdownTable,
    computeTargetCell: (cell: ActiveCell, oldTable: MarkdownTable, newTable: MarkdownTable) => TargetCell
) {
    return (view: EditorView, cell: ActiveCell, options?: StructuralReopenOptions): boolean =>
        runStructuralMutationAndReopen({
            view,
            cell,
            operation,
            computeTargetCell,
            ...getDefaultStructuralReopenOptions(view),
            ...options,
        });
}

function createRowInsertOperation(
    operation: (table: MarkdownTable, cell: ActiveCell) => MarkdownTable,
    computeTargetCell: (cell: ActiveCell, oldTable: MarkdownTable, newTable: MarkdownTable) => TargetCell
) {
    return (view: EditorView, cell: ActiveCell, options?: RowInsertOpenOptions): boolean =>
        runStructuralMutationAndReopen({
            view,
            cell,
            operation,
            computeTargetCell,
            ...getDefaultRowInsertOpenOptions(view),
            ...options,
        });
}

export const insertRowAbove = createRowInsertOperation(
    (table, cell) => table.insertRowRelativeTo(cell.section, cell.row, 'before'),
    (cell) => targetInsertedRowBefore(cell)
);

export const insertRowBelow = createRowInsertOperation(
    (table, cell) => table.insertRowRelativeTo(cell.section, cell.row, 'after'),
    (cell) => targetInsertedRowAfter(cell)
);

export const insertColumnLeft = createReopeningStructuralOperation(
    (table, cell) => table.insertColumn(cell.col, 'before'),
    (cell) => sameCell(cell)
);

export const insertColumnRight = createReopeningStructuralOperation(
    (table, cell) => table.insertColumn(cell.col, 'after'),
    (cell) => ({ section: cell.section, row: cell.row, col: cell.col + 1 })
);

export const deleteRow = createReopeningStructuralOperation(
    (table, cell) => table.deleteRowAt(cell.section, cell.row),
    (cell) => targetDeletedRow(cell)
);

export const deleteColumn = createReopeningStructuralOperation(
    (table, cell) => table.deleteColumn(cell.col),
    (cell) => targetDeletedColumn(cell)
);

export const moveRowUp = createReopeningStructuralOperation(
    (table, cell) => table.moveRow(cell.section, cell.row, 'up'),
    (cell) => targetMovedRowUp(cell)
);

export const moveRowDown = createReopeningStructuralOperation(
    (table, cell) => table.moveRow(cell.section, cell.row, 'down'),
    (cell) => targetMovedRowDown(cell)
);

export const moveColumnLeft = createReopeningStructuralOperation(
    (table, cell) => table.swapColumns(cell.col, cell.col - 1),
    (cell) => ({ ...cell, col: cell.col - 1 })
);

export const moveColumnRight = createReopeningStructuralOperation(
    (table, cell) => table.swapColumns(cell.col, cell.col + 1),
    (cell) => ({ ...cell, col: cell.col + 1 })
);

export const clearTable = createReopeningStructuralOperation(
    (table) => table.clearAllCells(),
    (cell) => sameCell(cell)
);

export const clearRow = createReopeningStructuralOperation(
    (table, cell) => table.clearRow(cell.section, cell.row),
    (cell) => sameCell(cell)
);

export const clearColumn = createReopeningStructuralOperation(
    (table, cell) => table.clearColumn(cell.col),
    (cell) => sameCell(cell)
);

export function deleteTable(view: EditorView, cell: ActiveCell): boolean {
    const resolvedCell = resolveActiveCell(view.state, cell);
    if (!resolvedCell) {
        return false;
    }

    view.dispatch({
        changes: { from: resolvedCell.tableFrom, to: resolvedCell.tableTo, insert: '' },
        effects: [
            clearActiveCellEffect.of(undefined),
            rebuildTableWidgetsEffect.of({ tableFrom: resolvedCell.tableFrom }),
        ],
    });

    focusMainEditorWithoutScroll(view);

    return true;
}

export function updateAlignment(
    view: EditorView,
    cell: ActiveCell,
    align: CommandColumnAlignment,
    options?: StructuralReopenOptions
): boolean {
    return runStructuralMutationAndReopen({
        view,
        cell,
        operation: (table, currentCell) => table.updateColumnAlignment(currentCell.col, align),
        computeTargetCell: (currentCell) => sameCell(currentCell),
        ...getDefaultStructuralReopenOptions(view),
        ...options,
    });
}

export function insertRowAtBottom(
    view: EditorView,
    cell: ActiveCell,
    targetCol: number,
    options?: RowInsertOpenOptions
): boolean {
    return runStructuralMutationAndReopen({
        view,
        cell,
        operation: (table, currentCell) => table.insertRowRelativeTo(currentCell.section, currentCell.row, 'after'),
        computeTargetCell: (currentCell) => targetInsertedRowAtBottom(currentCell, targetCol),
        ...getDefaultRowInsertOpenOptions(view),
        ...options,
    });
}

export function insertTableAndActivate(view: EditorView): boolean {
    const cursorPos = view.state.selection.main.head;
    const rewrite = buildIsolatedRootTableInsertRewrite(
        view.state,
        cursorPos,
        cursorPos,
        DEFAULT_INSERTED_TABLE_MARKDOWN
    ) ?? {
        changes: {
            from: cursorPos,
            to: cursorPos,
            insert: `\n${DEFAULT_INSERTED_TABLE_MARKDOWN}\n`,
        },
        tableFrom: cursorPos + 1,
    };

    view.dispatch({
        changes: rewrite.changes,
        selection: { anchor: rewrite.tableFrom + DEFAULT_INSERTED_TABLE_SELECTION_OFFSET },
    });

    activateTableCell(view, rewrite.tableFrom, { section: 'header', row: 0, col: 0 });
    return true;
}

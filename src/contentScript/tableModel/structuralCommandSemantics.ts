import { MarkdownTable, type TableAlignment } from './MarkdownTable';
import type { TargetCell } from './activeCellForTableText';
import type { CellCoords } from './types';
import type { TableSortDirection } from './rawMarkdownSort';

export type StructuralTableCommandById = {
    insertRowBefore: {
        type: 'insertRowBefore';
    };
    insertRowAfter: {
        type: 'insertRowAfter';
        targetCol?: number;
    };
    insertColumnBefore: {
        type: 'insertColumnBefore';
    };
    insertColumnAfter: {
        type: 'insertColumnAfter';
    };
    deleteRow: {
        type: 'deleteRow';
    };
    deleteColumn: {
        type: 'deleteColumn';
    };
    moveRowUp: {
        type: 'moveRowUp';
    };
    moveRowDown: {
        type: 'moveRowDown';
    };
    moveColumnLeft: {
        type: 'moveColumnLeft';
    };
    moveColumnRight: {
        type: 'moveColumnRight';
    };
    clearRow: {
        type: 'clearRow';
    };
    clearColumn: {
        type: 'clearColumn';
    };
    clearTable: {
        type: 'clearTable';
    };
    deleteTable: {
        type: 'deleteTable';
    };
    sortColumnAscending: {
        type: 'sortColumnAscending';
    };
    sortColumnDescending: {
        type: 'sortColumnDescending';
    };
};

export type StructuralTableCommandId = keyof StructuralTableCommandById;

export type StructuralTableCommand =
    | StructuralTableCommandById[StructuralTableCommandId]
    | {
          type: 'alignColumn';
          alignment: TableAlignment;
      };

interface StructuralTableMutationResult {
    kind: 'table';
    table: MarkdownTable;
    targetCell: TargetCell;
}

interface StructuralTableDeleteResult {
    kind: 'deleteTable';
}

export type StructuralTableCommandResult = StructuralTableMutationResult | StructuralTableDeleteResult;

function sameCell(cell: CellCoords): TargetCell {
    return cell;
}

function commandResult(
    originalTable: MarkdownTable,
    activeCell: CellCoords,
    table: MarkdownTable,
    targetCell: TargetCell
): StructuralTableMutationResult {
    return {
        kind: 'table',
        table,
        targetCell: table === originalTable ? sameCell(activeCell) : targetCell,
    };
}

function targetInsertedRowBefore(cell: CellCoords): TargetCell {
    return cell.section === 'header'
        ? { section: 'header', row: 0, col: cell.col }
        : { section: 'body', row: cell.row, col: cell.col };
}

function targetInsertedRowAfter(cell: CellCoords, targetCol: number = cell.col): TargetCell {
    return cell.section === 'header'
        ? { section: 'body', row: 0, col: targetCol }
        : { section: 'body', row: cell.row + 1, col: targetCol };
}

function targetDeletedRow(cell: CellCoords, table: MarkdownTable): TargetCell {
    if (cell.section === 'header') {
        return { section: 'header', row: 0, col: cell.col };
    }

    if (cell.row < table.bodyRows.length - 1) {
        return { section: 'body', row: cell.row, col: cell.col };
    }

    if (cell.row > 0) {
        return { section: 'body', row: cell.row - 1, col: cell.col };
    }

    return { section: 'header', row: 0, col: cell.col };
}

function targetDeletedColumn(cell: CellCoords, table: MarkdownTable): TargetCell {
    return {
        section: cell.section,
        row: cell.row,
        col: cell.col < table.columnCount - 1 ? cell.col : cell.col - 1,
    };
}

function isValidBodyRow(table: MarkdownTable, row: number): boolean {
    return row >= 0 && row < table.bodyRows.length;
}

function isValidColumn(table: MarkdownTable, col: number): boolean {
    return col >= 0 && col < table.columnCount;
}

function shouldDeleteWholeTableFromRow(table: MarkdownTable, activeCell: CellCoords): boolean {
    return (
        table.rowCount === 1 &&
        (activeCell.section === 'header' || (activeCell.section === 'body' && isValidBodyRow(table, activeCell.row)))
    );
}

function deleteRowResult(table: MarkdownTable, activeCell: CellCoords): StructuralTableCommandResult {
    if (shouldDeleteWholeTableFromRow(table, activeCell)) {
        return { kind: 'deleteTable' };
    }

    return commandResult(
        table,
        activeCell,
        table.deleteRowAt(activeCell.section, activeCell.row),
        targetDeletedRow(activeCell, table)
    );
}

function deleteColumnResult(table: MarkdownTable, activeCell: CellCoords): StructuralTableCommandResult {
    if (!isValidColumn(table, activeCell.col)) {
        return commandResult(table, activeCell, table, sameCell(activeCell));
    }

    if (table.columnCount === 1) {
        return { kind: 'deleteTable' };
    }

    return commandResult(table, activeCell, table.deleteColumn(activeCell.col), targetDeletedColumn(activeCell, table));
}

function targetMovedRowUp(cell: CellCoords): TargetCell {
    return cell.row === 0
        ? { section: 'header', row: 0, col: cell.col }
        : { section: 'body', row: cell.row - 1, col: cell.col };
}

function targetMovedRowDown(cell: CellCoords): TargetCell {
    return cell.section === 'header'
        ? { section: 'body', row: 0, col: cell.col }
        : { section: 'body', row: cell.row + 1, col: cell.col };
}

function sortColumnResult(
    table: MarkdownTable,
    activeCell: CellCoords,
    direction: TableSortDirection
): StructuralTableMutationResult {
    const result = table.sortBodyRowsByColumn(activeCell.col, direction);
    const targetCell =
        activeCell.section === 'body'
            ? {
                  ...activeCell,
                  row: result.sortedIndexByOriginalIndex[activeCell.row] ?? activeCell.row,
              }
            : sameCell(activeCell);

    return commandResult(table, activeCell, result.table, targetCell);
}

export function applyStructuralTableCommand(
    table: MarkdownTable,
    activeCell: CellCoords,
    command: StructuralTableCommand
): StructuralTableCommandResult {
    switch (command.type) {
        case 'insertRowBefore':
            return commandResult(
                table,
                activeCell,
                table.insertRowRelativeTo(activeCell.section, activeCell.row, 'before'),
                targetInsertedRowBefore(activeCell)
            );
        case 'insertRowAfter':
            return commandResult(
                table,
                activeCell,
                table.insertRowRelativeTo(activeCell.section, activeCell.row, 'after'),
                targetInsertedRowAfter(activeCell, command.targetCol)
            );
        case 'insertColumnBefore':
            return commandResult(table, activeCell, table.insertColumn(activeCell.col, 'before'), sameCell(activeCell));
        case 'insertColumnAfter':
            return commandResult(table, activeCell, table.insertColumn(activeCell.col, 'after'), {
                section: activeCell.section,
                row: activeCell.row,
                col: activeCell.col + 1,
            });
        case 'deleteRow':
            return deleteRowResult(table, activeCell);
        case 'deleteColumn':
            return deleteColumnResult(table, activeCell);
        case 'moveRowUp':
            return commandResult(
                table,
                activeCell,
                table.moveRow(activeCell.section, activeCell.row, 'up'),
                targetMovedRowUp(activeCell)
            );
        case 'moveRowDown':
            return commandResult(
                table,
                activeCell,
                table.moveRow(activeCell.section, activeCell.row, 'down'),
                targetMovedRowDown(activeCell)
            );
        case 'moveColumnLeft':
            return commandResult(table, activeCell, table.swapColumns(activeCell.col, activeCell.col - 1), {
                ...activeCell,
                col: activeCell.col - 1,
            });
        case 'moveColumnRight':
            return commandResult(table, activeCell, table.swapColumns(activeCell.col, activeCell.col + 1), {
                ...activeCell,
                col: activeCell.col + 1,
            });
        case 'clearTable':
            return commandResult(table, activeCell, table.clearAllCells(), sameCell(activeCell));
        case 'clearRow':
            return commandResult(
                table,
                activeCell,
                table.clearRow(activeCell.section, activeCell.row),
                sameCell(activeCell)
            );
        case 'clearColumn':
            return commandResult(table, activeCell, table.clearColumn(activeCell.col), sameCell(activeCell));
        case 'alignColumn':
            return commandResult(
                table,
                activeCell,
                table.updateColumnAlignment(activeCell.col, command.alignment),
                sameCell(activeCell)
            );
        case 'deleteTable':
            return { kind: 'deleteTable' };
        case 'sortColumnAscending':
            return sortColumnResult(table, activeCell, 'ascending');
        case 'sortColumnDescending':
            return sortColumnResult(table, activeCell, 'descending');
    }
}

import { MarkdownTable, type TableAlignment } from './MarkdownTable';
import type { TargetCell } from './activeCellForTableText';
import type { CellCoords } from './types';

export type StructuralTableCommandId =
    | 'insertRowBefore'
    | 'insertRowAfter'
    | 'insertColumnBefore'
    | 'insertColumnAfter'
    | 'deleteRow'
    | 'deleteColumn'
    | 'moveRowUp'
    | 'moveRowDown'
    | 'moveColumnLeft'
    | 'moveColumnRight'
    | 'clearRow'
    | 'clearColumn'
    | 'clearTable';

export type StructuralTableCommand =
    | {
          type: Exclude<StructuralTableCommandId, 'insertRowAfter'>;
      }
    | {
          type: 'insertRowAfter';
          targetCol?: number;
      }
    | {
          type: 'alignColumn';
          alignment: TableAlignment;
      };

export interface StructuralTableCommandResult {
    table: MarkdownTable;
    targetCell: TargetCell;
}

function sameCell(cell: CellCoords): TargetCell {
    return cell;
}

function commandResult(
    originalTable: MarkdownTable,
    activeCell: CellCoords,
    table: MarkdownTable,
    targetCell: TargetCell
): StructuralTableCommandResult {
    return {
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

function targetDeletedRow(cell: CellCoords): TargetCell {
    return cell.section === 'header'
        ? { section: 'header', row: 0, col: cell.col }
        : { section: 'body', row: Math.max(0, cell.row - 1), col: cell.col };
}

function targetDeletedColumn(cell: CellCoords): TargetCell {
    return { section: cell.section, row: cell.row, col: Math.max(0, cell.col - 1) };
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
            return commandResult(
                table,
                activeCell,
                table.deleteRowAt(activeCell.section, activeCell.row),
                targetDeletedRow(activeCell)
            );
        case 'deleteColumn':
            return commandResult(
                table,
                activeCell,
                table.deleteColumn(activeCell.col),
                targetDeletedColumn(activeCell)
            );
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
    }
}

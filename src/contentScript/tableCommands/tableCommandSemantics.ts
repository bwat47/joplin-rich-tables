import type { ActiveCell } from '../tableWidget/activeCellState';
import { MarkdownTable } from '../tableModel/MarkdownTable';

/**
 * Applies the row-insert action relative to the currently active cell.
 */
export function insertRowForActiveCell(
    table: MarkdownTable,
    cell: ActiveCell,
    where: 'before' | 'after'
): MarkdownTable {
    return table.insertRowRelativeTo(cell.section, cell.row, where);
}

/**
 * Applies the row-delete action relative to the currently active cell.
 */
export function deleteRowForActiveCell(table: MarkdownTable, cell: ActiveCell): MarkdownTable {
    return table.deleteRowAt(cell.section, cell.row);
}

export function moveRowForActiveCell(
    table: MarkdownTable,
    cell: ActiveCell,
    direction: 'up' | 'down'
): MarkdownTable {
    return table.moveRow(cell.section, cell.row, direction);
}

export function moveColumnForActiveCell(
    table: MarkdownTable,
    cell: ActiveCell,
    direction: 'left' | 'right'
): MarkdownTable {
    if (direction === 'left') {
        if (cell.col === 0) {
            return table;
        }
        return table.swapColumns(cell.col, cell.col - 1);
    }

    if (cell.col === table.columnCount - 1) {
        return table;
    }
    return table.swapColumns(cell.col, cell.col + 1);
}

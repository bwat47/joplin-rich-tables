import type { ActiveCell } from '../tableWidget/activeCellState';
import type { TableData } from '../tableModel/markdownTableParsing';
import { deleteRow, insertRow, swapRows, swapColumns } from '../tableModel/markdownTableManipulation';

function createEmptyCells(columnCount: number): string[] {
    return new Array(columnCount).fill('');
}

/**
 * Applies the row-insert action relative to the currently active cell.
 *
 * Header-row semantics:
 * - Insert row after: add a new body row after header (as the 1st body row)
 * - Insert row before: create new empty header; old header becomes the 1st body row
 */
export function insertRowForActiveCell(table: TableData, cell: ActiveCell, where: 'before' | 'after'): TableData {
    if (cell.section === 'header') {
        if (where === 'after') {
            const empty = createEmptyCells(table.headers.length);
            return {
                ...table,
                rows: [empty, ...table.rows],
            };
        }

        const emptyHeader = createEmptyCells(table.headers.length);
        return {
            headers: emptyHeader,
            alignments: table.alignments,
            rows: [table.headers, ...table.rows],
        };
    }

    return insertRow(table, cell.row, where);
}

/**
 * Applies the row-delete action relative to the currently active cell.
 *
 * Header-row semantics:
 * - Delete header: delete header row and promote 1st body row to header
 * - Disallow if it would leave a header-only table (i.e., only one body row exists)
 */
export function deleteRowForActiveCell(table: TableData, cell: ActiveCell): TableData {
    if (cell.section === 'header') {
        if (table.rows.length <= 1) {
            return table;
        }

        const [newHeader, ...remainingRows] = table.rows;
        return {
            headers: newHeader,
            alignments: table.alignments,
            rows: remainingRows,
        };
    }

    return deleteRow(table, cell.row);
}

export function moveRowForActiveCell(table: TableData, cell: ActiveCell, direction: 'up' | 'down'): TableData {
    // If table has no body rows (header only), we can't move anything
    if (table.rows.length === 0) {
        return table;
    }

    const currentRowIndex = cell.section === 'header' ? -1 : cell.row;
    let targetRowIndex: number;

    if (direction === 'up') {
        if (currentRowIndex === -1) return table; // Can't move header up
        targetRowIndex = currentRowIndex - 1;
    } else {
        if (currentRowIndex === table.rows.length - 1) return table; // Can't move last row down
        targetRowIndex = currentRowIndex + 1;
    }

    return swapRows(table, currentRowIndex, targetRowIndex);
}

export function moveColumnForActiveCell(table: TableData, cell: ActiveCell, direction: 'left' | 'right'): TableData {
    // If table has only 1 column, we can't move anything
    if (table.headers.length <= 1) {
        return table;
    }

    const currentColIndex = cell.col;
    let targetColIndex: number;

    if (direction === 'left') {
        if (currentColIndex === 0) return table;
        targetColIndex = currentColIndex - 1;
    } else {
        if (currentColIndex === table.headers.length - 1) return table;
        targetColIndex = currentColIndex + 1;
    }

    return swapColumns(table, currentColIndex, targetColIndex);
}

import type { ActiveCell } from './activeCellState';
import type { TableData } from './markdownTableParsing';
import { deleteRow, insertRow } from './markdownTableManipulation';

function createEmptyCells(columnCount: number): string[] {
    return new Array(columnCount).fill('');
}

/**
 * Applies the floating-toolbar row-insert action relative to the currently active cell.
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
 * Applies the floating-toolbar row-delete action relative to the currently active cell.
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

import { MarkdownTable, type TableAlignment } from './MarkdownTable';
import type { TableData } from './markdownTableParsing';

export function insertRow(table: TableData, rowIndex: number, where: 'before' | 'after'): TableData {
    return MarkdownTable.fromData(table).insertRowRelativeTo('body', rowIndex, where).toData();
}

export function deleteRow(table: TableData, rowIndex: number): TableData {
    const model = MarkdownTable.fromData(table);
    const next = model.deleteRowAt('body', rowIndex);
    return next === model ? table : next.toData();
}

export function insertColumn(table: TableData, colIndex: number, where: 'before' | 'after'): TableData {
    return MarkdownTable.fromData(table).insertColumn(colIndex, where).toData();
}

export function deleteColumn(table: TableData, colIndex: number): TableData {
    const model = MarkdownTable.fromData(table);
    const next = model.deleteColumn(colIndex);
    return next === model ? table : next.toData();
}

export function updateColumnAlignment(table: TableData, colIndex: number, alignment: TableAlignment): TableData {
    const model = MarkdownTable.fromData(table);
    const next = model.updateColumnAlignment(colIndex, alignment);
    return next === model ? table : next.toData();
}

export function swapRows(table: TableData, row1: number, row2: number): TableData {
    const model = MarkdownTable.fromData(table);
    const next = model.swapRows(row1, row2);
    return next === model ? table : next.toData();
}

export function swapColumns(table: TableData, col1: number, col2: number): TableData {
    const model = MarkdownTable.fromData(table);
    const next = model.swapColumns(col1, col2);
    return next === model ? table : next.toData();
}

/**
 * Serializes the TableData back to a Markdown table string.
 * Canonical serialization ownership now lives in `MarkdownTable.serialize()`.
 */
export function serializeTable(table: TableData): string {
    return MarkdownTable.fromData(table).serialize();
}

/**
 * Clears all cell contents (headers and body) while preserving
 * table structure (row/column count and column alignments).
 */
export function clearAllCells(table: TableData): TableData {
    const model = MarkdownTable.fromData(table);
    const next = model.clearAllCells();
    return next === model ? table : next.toData();
}

/**
 * Clears all cells in the target row while preserving table shape and alignments.
 */
export function clearRow(table: TableData, section: 'header' | 'body', rowIndex: number): TableData {
    const model = MarkdownTable.fromData(table);
    const next = model.clearRow(section, rowIndex);
    return next === model ? table : next.toData();
}

/**
 * Clears all cells in the target column while preserving table shape and alignments.
 */
export function clearColumn(table: TableData, colIndex: number): TableData {
    const model = MarkdownTable.fromData(table);
    const next = model.clearColumn(colIndex);
    return next === model ? table : next.toData();
}

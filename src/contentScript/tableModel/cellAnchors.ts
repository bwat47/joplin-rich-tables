import type { CellRange, TableCellRanges } from './markdownTableCellRanges';
import type { SerializedTable } from './MarkdownTable';
import type { CellCoords } from './types';
import { clamp } from '../shared/numberUtils';

export interface TableCellAnchor extends CellCoords {
    anchorOffset: number;
}

export interface ClampedCell {
    coords: CellCoords;
    range: CellRange;
}

/**
 * Clamps `target` onto a cell the ranges contain, returning that cell and its table-relative range.
 *
 * Every parsed row has at least one cell, so clamping always lands on a real one.
 */
export function clampCellToRanges(ranges: TableCellRanges, target: CellCoords): ClampedCell {
    const safeCol = clamp(target.col, 0, ranges.headers.length - 1);

    // A table without body rows falls back to its header.
    if (target.section === 'header' || ranges.rows.length === 0) {
        return { coords: { section: 'header', row: 0, col: safeCol }, range: ranges.headers[safeCol] };
    }

    const safeRow = clamp(target.row, 0, ranges.rows.length - 1);
    // Ragged rows can be shorter than the header.
    const row = ranges.rows[safeRow];
    const safeColInRow = clamp(safeCol, 0, row.length - 1);

    return { coords: { section: 'body', row: safeRow, col: safeColInRow }, range: row[safeColInRow] };
}

/** A serialized table is rectangular, so clamping needs only its column and row counts. */
function clampTargetToTable(serialized: SerializedTable, target: CellCoords): CellCoords | null {
    const colCount = serialized.columnCount;
    if (colCount <= 0) {
        return null;
    }

    const safeCol = clamp(target.col, 0, colCount - 1);
    // `rowCount` counts the header, so anything above 1 means the table has body rows.
    const bodyRowCount = serialized.rowCount - 1;
    if (target.section === 'header' || bodyRowCount <= 0) {
        return { section: 'header', row: 0, col: safeCol };
    }

    return { section: 'body', row: clamp(target.row, 0, bodyRowCount - 1), col: safeCol };
}

/**
 * Builds a relative cell anchor against a table's canonical serialization.
 *
 * Takes the serialization rather than the model, so the anchor can only describe text the
 * caller actually holds; nothing here parses that text back into ranges.
 */
export function computeCellAnchorForTable(params: {
    serialized: SerializedTable;
    target: CellCoords;
}): TableCellAnchor | null {
    const clamped = clampTargetToTable(params.serialized, params.target);
    if (!clamped) {
        return null;
    }

    const anchorOffset = params.serialized.cellOffset(clamped);
    return anchorOffset === null ? null : { anchorOffset, ...clamped };
}

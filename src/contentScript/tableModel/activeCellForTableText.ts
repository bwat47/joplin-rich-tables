import { getCellRange, type TableCellRanges } from './markdownTableCellRanges';
import type { MarkdownTable } from './MarkdownTable';
import type { CellCoords } from './types';
import { clamp } from '../shared/numberUtils';

export type TargetCell = CellCoords;
export interface TableCellAnchor extends TargetCell {
    anchorOffset: number;
}

function clampTargetToRanges(target: TargetCell, ranges: TableCellRanges): TargetCell {
    const colCount = ranges.headers.length;
    const safeCol = colCount > 0 ? clamp(target.col, 0, colCount - 1) : 0;

    if (target.section === 'header') {
        return { section: 'header', row: 0, col: safeCol };
    }

    const rowCount = ranges.rows.length;
    if (rowCount <= 0) {
        // No body rows left; fall back to header.
        return { section: 'header', row: 0, col: safeCol };
    }

    const safeRow = clamp(target.row, 0, rowCount - 1);

    // Some tables can have ragged rows; clamp to the actual row length if needed.
    const rowColCount = ranges.rows[safeRow]?.length ?? colCount;
    const safeColInRow = rowColCount > 0 ? clamp(safeCol, 0, rowColCount - 1) : 0;

    return { section: 'body', row: safeRow, col: safeColInRow };
}

/**
 * Builds a new relative cell anchor from pre-computed cell ranges and a target position.
 * Use this when a `TableContext` (or cellRanges) is already available.
 */
export function computeCellAnchorFromRanges(params: {
    ranges: TableCellRanges;
    target: TargetCell;
}): TableCellAnchor | null {
    const { ranges, target } = params;
    const clamped = clampTargetToRanges(target, ranges);

    const relRange = getCellRange(ranges, clamped);
    if (!relRange) {
        return null;
    }

    return {
        anchorOffset: relRange.editableFrom,
        section: clamped.section,
        row: clamped.section === 'header' ? 0 : clamped.row,
        col: clamped.col,
    };
}

/** A serialized table is rectangular, so clamping needs only its column and row counts. */
function clampTargetToTable(table: MarkdownTable, target: TargetCell): TargetCell | null {
    const colCount = table.columnCount;
    if (colCount <= 0) {
        return null;
    }

    const safeCol = clamp(target.col, 0, colCount - 1);
    // `rowCount` counts the header, so anything above 1 means the table has body rows.
    const bodyRowCount = table.rowCount - 1;
    if (target.section === 'header' || bodyRowCount <= 0) {
        return { section: 'header', row: 0, col: safeCol };
    }

    return { section: 'body', row: clamp(target.row, 0, bodyRowCount - 1), col: safeCol };
}

/**
 * Builds a relative cell anchor against a table's canonical serialization.
 *
 * Callers hold the model that produced the text, so the anchor is computed from the
 * serialization format directly instead of parsing that text back into ranges.
 */
export function computeCellAnchorForTable(params: {
    table: MarkdownTable;
    target: TargetCell;
}): TableCellAnchor | null {
    const clamped = clampTargetToTable(params.table, params.target);
    if (!clamped) {
        return null;
    }

    const anchorOffset = params.table.serializedCellOffset(clamped);
    return anchorOffset === null ? null : { anchorOffset, ...clamped };
}

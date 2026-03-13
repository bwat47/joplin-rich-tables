import { computeMarkdownTableCellRanges, getCellRange, type TableCellRanges } from './markdownTableCellRanges';
import type { ActiveCell } from '../tableWidget/activeCellState';
import type { CellCoords } from './types';

export type TargetCell = CellCoords;

function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
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
 * Builds a new `ActiveCell` from pre-computed cell ranges and a target position.
 * Use this when a `TableContext` (or cellRanges) is already available.
 */
export function computeActiveCellFromRanges(params: {
    tableFrom: number;
    tableTo: number;
    ranges: TableCellRanges;
    target: TargetCell;
}): ActiveCell | null {
    const { tableFrom, tableTo, ranges, target } = params;
    const clamped = clampTargetToRanges(target, ranges);

    const relRange = getCellRange(ranges, clamped);
    if (!relRange) {
        return null;
    }

    return {
        tableFrom,
        tableTo,
        cellFrom: tableFrom + relRange.from,
        cellTo: tableFrom + relRange.to,
        section: clamped.section,
        row: clamped.section === 'header' ? 0 : clamped.row,
        col: clamped.col,
    };
}

/**
 * Builds a new `ActiveCell` for a target (section,row,col) based on the provided table markdown.
 *
 * Returns null if the table text can't be ranged (invalid markdown table).
 */
export function computeActiveCellForTableText(params: {
    tableFrom: number;
    tableText: string;
    target: TargetCell;
}): ActiveCell | null {
    const { tableFrom, tableText, target } = params;
    const ranges = computeMarkdownTableCellRanges(tableText);
    if (!ranges) {
        return null;
    }

    return computeActiveCellFromRanges({
        tableFrom,
        tableTo: tableFrom + tableText.length,
        ranges,
        target,
    });
}

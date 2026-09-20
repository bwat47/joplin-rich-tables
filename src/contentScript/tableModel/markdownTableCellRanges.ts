/**
 * Computes source ranges (from/to positions) for each table cell.
 *
 * Lezer owns table and cell syntax. This module derives editor-specific semantic and
 * editable ranges from those syntax facts. Callers must pass the exact table text;
 * all returned ranges are table-relative.
 */
import type {
    MarkdownTableSourceRange,
    MarkdownTableSyntax,
    MarkdownTableSyntaxCell,
    MarkdownTableSyntaxRow,
} from './lezerTableSyntax';
import { isTablePadding } from '../shared/tablePadding';
import type { CellCoords } from './types';

export interface CellRange {
    readonly from: number;
    readonly to: number;
    readonly editableFrom: number;
    readonly editableTo: number;
}

export interface TableCellRanges {
    readonly headers: readonly CellRange[];
    readonly rows: readonly (readonly CellRange[])[];
}

function emptyCellBounds(tableText: string, raw: MarkdownTableSourceRange): MarkdownTableSourceRange {
    const insertion = raw.from < raw.to && isTablePadding(tableText[raw.from]) ? raw.from + 1 : raw.from;
    return { from: insertion, to: insertion };
}

function editableCellBounds(tableText: string, raw: MarkdownTableSourceRange): MarkdownTableSourceRange {
    let from = raw.from;
    let to = raw.to;

    if (from < to && isTablePadding(tableText[from])) {
        from++;
    }
    if (to > from && isTablePadding(tableText[to - 1])) {
        to--;
    }

    // Bounds come from the raw delimiter gap, so one pad character stays outside edits on
    // each side. Deleting it could escape the following pipe after a trailing backslash.
    return { from, to };
}

function toCellRange(tableText: string, cell: MarkdownTableSyntaxCell): CellRange {
    const semantic = cell.content ?? emptyCellBounds(tableText, cell.raw);
    const editable = editableCellBounds(tableText, cell.raw);

    return {
        from: semantic.from,
        to: semantic.to,
        editableFrom: editable.from,
        editableTo: editable.to,
    };
}

function toRowCellRanges(tableText: string, row: MarkdownTableSyntaxRow): readonly CellRange[] {
    return row.cells.map((cell) => toCellRange(tableText, cell));
}

/**
 * Computes per-cell source ranges (relative to `tableText`) for header/body rows.
 *
 * Notes:
 * - `tableText` must be the exact table source matching `syntax`.
 * - All returned ranges are table-relative.
 * - Lezer supplies row membership, delimiter positions, and non-empty content bounds.
 * - Exposes both syntax-backed semantic bounds (`from/to`) and editable bounds
 *   (`editableFrom/editableTo`) for nested editing and selection sync.
 */
export function computeMarkdownTableCellRangesFromSyntax(
    tableText: string,
    syntax: MarkdownTableSyntax
): TableCellRanges {
    return {
        headers: toRowCellRanges(tableText, syntax.header),
        rows: syntax.bodyRows.map((row) => toRowCellRanges(tableText, row)),
    };
}

/**
 * Finds the cell coordinates for a given position within the table text.
 * This is the inverse of getCellRange - given a position, find which cell contains it.
 *
 * @param ranges - The computed cell ranges for the table
 * @param relativePos - Position relative to the start of the table text
 * @returns Cell coordinates if position is within a cell, null otherwise
 */
export function findCellForPos(ranges: TableCellRanges, relativePos: number): CellCoords | null {
    // Check header cells
    for (let col = 0; col < ranges.headers.length; col++) {
        const r = ranges.headers[col];
        if (relativePos >= r.editableFrom && relativePos <= r.editableTo) {
            return { section: 'header', row: 0, col };
        }
    }

    // Check body cells
    for (let row = 0; row < ranges.rows.length; row++) {
        const rowCells = ranges.rows[row];
        for (let col = 0; col < rowCells.length; col++) {
            const r = rowCells[col];
            if (relativePos >= r.editableFrom && relativePos <= r.editableTo) {
                return { section: 'body', row, col };
            }
        }
    }

    return null;
}

/**
 * Gets the cell range for the given coordinates.
 * Helper to avoid duplicating the section-based range lookup logic.
 *
 * @param ranges - The computed cell ranges for the table
 * @param coords - Cell coordinates (section, row, col)
 * @returns The cell range if valid, undefined otherwise
 */
export function getCellRange(ranges: TableCellRanges, coords: CellCoords): CellRange | undefined {
    return coords.section === 'header' ? ranges.headers[coords.col] : ranges.rows[coords.row]?.[coords.col];
}

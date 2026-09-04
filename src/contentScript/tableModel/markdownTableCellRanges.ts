/**
 * Computes source ranges (from/to positions) for each table cell.
 *
 * Lezer owns table and cell syntax. This module derives editor-specific semantic and
 * editable ranges from those syntax facts.
 */
import {
    parseRootMarkdownTableSyntax,
    type MarkdownTableSourceRange,
    type MarkdownTableSyntax,
    type MarkdownTableSyntaxCell,
    type MarkdownTableSyntaxRow,
} from './lezerTableSyntax';
import type { CellCoords } from './types';

export interface CellRange {
    from: number;
    to: number;
    editableFrom: number;
    editableTo: number;
}

export interface TableCellRanges {
    headers: CellRange[];
    rows: CellRange[][];
}

function isDelimiterPadding(character: string | undefined): boolean {
    return character === ' ' || character === '\t';
}

function offsetRange(range: MarkdownTableSourceRange, tableFrom: number): MarkdownTableSourceRange {
    return { from: tableFrom + range.from, to: tableFrom + range.to };
}

function emptyCellBounds(text: string, raw: MarkdownTableSourceRange): MarkdownTableSourceRange {
    const insertion = raw.from < raw.to && isDelimiterPadding(text[raw.from]) ? raw.from + 1 : raw.from;
    return { from: insertion, to: insertion };
}

function editableCellBounds(text: string, raw: MarkdownTableSourceRange): MarkdownTableSourceRange {
    let from = raw.from;
    let to = raw.to;

    if (from < to && isDelimiterPadding(text[from])) {
        from++;
    }
    if (to > from && isDelimiterPadding(text[to - 1])) {
        to--;
    }

    return { from, to };
}

function toCellRange(text: string, cell: MarkdownTableSyntaxCell, tableFrom: number): CellRange {
    const raw = offsetRange(cell.raw, tableFrom);
    const semantic = cell.content ? offsetRange(cell.content, tableFrom) : emptyCellBounds(text, raw);
    const editable = editableCellBounds(text, raw);

    return {
        from: semantic.from,
        to: semantic.to,
        editableFrom: editable.from,
        editableTo: editable.to,
    };
}

function toRowCellRanges(text: string, row: MarkdownTableSyntaxRow, tableFrom: number): CellRange[] {
    return row.cells.map((cell) => toCellRange(text, cell, tableFrom));
}

/**
 * Computes per-cell source ranges (relative to `text`) for header/body rows.
 *
 * Notes:
 * - Lezer supplies row membership, delimiter positions, and non-empty content bounds.
 * - Exposes both syntax-backed semantic bounds (`from/to`) and editable bounds
 *   (`editableFrom/editableTo`) for nested editing and selection sync.
 */
export function computeMarkdownTableCellRangesFromSyntax(
    text: string,
    syntax: MarkdownTableSyntax,
    tableFrom = 0
): TableCellRanges {
    return {
        headers: toRowCellRanges(text, syntax.header, tableFrom),
        rows: syntax.bodyRows.map((row) => toRowCellRanges(text, row, tableFrom)),
    };
}

export function computeMarkdownTableCellRanges(text: string): TableCellRanges | null {
    const parsed = parseRootMarkdownTableSyntax(text);
    return parsed ? computeMarkdownTableCellRangesFromSyntax(text, parsed.syntax, parsed.from) : null;
}

/**
 * Finds the cell coordinates for a given position within the table text.
 * This is the inverse of resolveCellDocRange - given a position, find which cell contains it.
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

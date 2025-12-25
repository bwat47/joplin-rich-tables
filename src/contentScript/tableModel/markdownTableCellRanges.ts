/**
 * Computes source ranges (from/to positions) for each table cell.
 *
 * Works with Lezer: Lezer detects table blocks, this module detects cell boundaries.
 * Uses `scanMarkdownTableRow()` for consistency. See markdownTableRowScanner.ts for rationale.
 */
import { scanMarkdownTableRow } from './markdownTableRowScanner';
import type { CellCoords } from './types';

export interface CellRange {
    from: number;
    to: number;
}

export interface TableCellRanges {
    headers: CellRange[];
    rows: CellRange[][];
}

/**
 * Check if a line is a valid separator row (contains only dashes, colons, pipes, spaces)
 */
export function isSeparatorRow(line: string): boolean {
    const trimmed = line.trim();
    // Must have at least one dash
    if (!trimmed.includes('-')) return false;
    // Should only contain valid separator characters
    return /^[\s|:\-]+$/.test(trimmed);
}

function getNonEmptyLinesWithOffsets(text: string): Array<{ line: string; from: number }> {
    const result: Array<{ line: string; from: number }> = [];
    const lines = text.split('\n');

    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().length > 0) {
            result.push({ line, from: offset });
        }

        offset += line.length;
        if (i < lines.length - 1) {
            offset += 1; // newline
        }
    }

    return result;
}

function findTrimBounds(line: string): { from: number; to: number } {
    let from = 0;
    let to = line.length;

    while (from < to && /\s/.test(line[from])) {
        from++;
    }
    while (to > from && /\s/.test(line[to - 1])) {
        to--;
    }

    return { from, to };
}

function trimCellBounds(line: string, from: number, to: number): { from: number; to: number } {
    let start = from;
    let end = to;

    while (start < end && /\s/.test(line[start])) {
        start++;
    }
    while (end > start && /\s/.test(line[end - 1])) {
        end--;
    }

    // If the cell is empty or whitespace-only (e.g. `|   |`), trimming collapses the
    // range to a boundary. That makes edits land right next to a pipe and removes
    // any trailing padding.
    //
    // For whitespace-only cells we pick a stable insertion point near the left edge
    // of the cell (after the first whitespace character, when possible). This avoids
    // typing appearing visually "centered" when tables are pretty-padded with spaces.
    if (start === end) {
        const insertion = Math.min(from + 1, to);
        return { from: insertion, to: insertion };
    }

    return { from: start, to: end };
}

function parseLineCellRanges(line: string, lineFromInTable: number): CellRange[] {
    const { from: trimFrom, to: trimTo } = findTrimBounds(line);
    if (trimTo <= trimFrom) {
        return [];
    }

    // Get all pipe delimiters from the scanner
    const { delimiters: allDelimiters } = scanMarkdownTableRow(line);

    // Remove leading/trailing pipes after trimming whitespace.
    let innerFrom = trimFrom;
    let innerTo = trimTo;
    if (allDelimiters.length > 0 && allDelimiters[0] === trimFrom) {
        innerFrom += 1;
    }
    if (allDelimiters.length > 0 && allDelimiters[allDelimiters.length - 1] === trimTo - 1) {
        innerTo -= 1;
    }

    // Filter delimiters to only those within the inner range
    const delimiters = allDelimiters.filter((i) => i > innerFrom && i < innerTo);

    const ranges: CellRange[] = [];
    let segmentStart = innerFrom;
    for (const delimiterIndex of delimiters) {
        const segmentEnd = delimiterIndex;
        const trimmed = trimCellBounds(line, segmentStart, segmentEnd);
        ranges.push({
            from: lineFromInTable + trimmed.from,
            to: lineFromInTable + trimmed.to,
        });
        segmentStart = delimiterIndex + 1;
    }

    // Last segment
    const lastTrimmed = trimCellBounds(line, segmentStart, innerTo);
    ranges.push({
        from: lineFromInTable + lastTrimmed.from,
        to: lineFromInTable + lastTrimmed.to,
    });

    return ranges;
}

/**
 * Computes per-cell source ranges (relative to `text`) for header/body rows.
 *
 * Notes:
 * - Uses the same "non-empty line" behavior as the table parser.
 * - Treats unescaped pipes as delimiters; escaped pipes (\|) stay inside a cell.
 * - Trims whitespace inside each cell so the returned ranges map to the rendered cell text.
 */
export function computeMarkdownTableCellRanges(text: string): TableCellRanges | null {
    const lines = getNonEmptyLinesWithOffsets(text);
    if (lines.length < 2) {
        return null;
    }

    const headerLine = lines[0];
    const separatorLine = lines[1];

    if (!headerLine.line.includes('|')) {
        return null;
    }
    if (!isSeparatorRow(separatorLine.line)) {
        return null;
    }

    const headerRanges = parseLineCellRanges(headerLine.line, headerLine.from);
    const rowRanges: CellRange[][] = [];

    for (let i = 2; i < lines.length; i++) {
        const lineInfo = lines[i];
        if (!lineInfo.line.includes('|')) {
            continue;
        }
        rowRanges.push(parseLineCellRanges(lineInfo.line, lineInfo.from));
    }

    return { headers: headerRanges, rows: rowRanges };
}

/**
 * Finds the cell coordinates for a given position within the table text.
 * This is the inverse of resolveCellDocRange - given a position, find which cell contains it.
 *
 * @param ranges - The computed cell ranges for the table
 * @param relativePos - Position relative to the table start (i.e., pos - tableFrom)
 * @returns Cell coordinates if position is within a cell, null otherwise
 */
export function findCellForPos(ranges: TableCellRanges, relativePos: number): CellCoords | null {
    // Check header cells
    for (let col = 0; col < ranges.headers.length; col++) {
        const r = ranges.headers[col];
        if (relativePos >= r.from && relativePos <= r.to) {
            return { section: 'header', row: 0, col };
        }
    }

    // Check body cells
    for (let row = 0; row < ranges.rows.length; row++) {
        const rowCells = ranges.rows[row];
        for (let col = 0; col < rowCells.length; col++) {
            const r = rowCells[col];
            if (relativePos >= r.from && relativePos <= r.to) {
                return { section: 'body', row, col };
            }
        }
    }

    return null;
}

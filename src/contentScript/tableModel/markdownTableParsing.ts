/**
 * Parses markdown tables into structured TableData (headers, alignments, rows).
 * Uses `computeMarkdownTableCellRanges()` to ensure that the parsed text content
 * matches the exact ranges used for editing.
 */
import { computeMarkdownTableCellRanges, isSeparatorRow } from './markdownTableCellRanges';
import { scanMarkdownTableRow } from './markdownTableRowScanner';

/**
 * Represents a parsed markdown table structure.
 */
export interface TableData {
    headers: string[];
    alignments: ('left' | 'center' | 'right' | null)[];
    rows: string[][];
}

/**
 * Parse alignment from separator row cell.
 * Examples: :--- (left), :---: (center), ---: (right), --- (none)
 */
function parseAlignment(cell: string): 'left' | 'center' | 'right' | null {
    const trimmed = cell.trim();
    const left = trimmed.startsWith(':');
    const right = trimmed.endsWith(':');

    if (left && right) return 'center';
    if (left) return 'left';
    if (right) return 'right';
    return null;
}

/**
 * Parse a row of pipe-separated cells from a raw separator string.
 *
 * Note: For the separator row, we still need to parse it "manually" here because `computeMarkdownTableCellRanges`
 * gives us ranges for headers and body rows, but intentionally skips the separator itself (it doesn't have "ranges"
 * useful for editing content).
 */
function parseSeparatorRow(line: string): string[] {
    const trimmed = line.trim();
    const { delimiters: allDelimiters } = scanMarkdownTableRow(trimmed);

    // Find boundaries (trim leading/trailing pipe)
    let innerFrom = 0;
    let innerTo = trimmed.length;

    if (allDelimiters.length > 0 && allDelimiters[0] === 0) {
        innerFrom += 1;
    }
    if (allDelimiters.length > 0 && allDelimiters[allDelimiters.length - 1] === trimmed.length - 1) {
        innerTo -= 1;
    }

    const delimiters = allDelimiters.filter((i) => i > innerFrom && i < innerTo);

    const cells: string[] = [];
    let segmentStart = innerFrom;
    for (const delimiterIndex of delimiters) {
        cells.push(trimmed.slice(segmentStart, delimiterIndex).trim());
        segmentStart = delimiterIndex + 1;
    }
    cells.push(trimmed.slice(segmentStart, innerTo).trim());

    return cells;
}

/**
 * Parse markdown table text into structured TableData.
 * Returns null if the text is not a valid table.
 */
export function parseMarkdownTable(text: string): TableData | null {
    // 1. Validate structure quickly
    const lines = text.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length < 2) return null;

    if (!lines[0].includes('|')) return null;
    if (!isSeparatorRow(lines[1])) return null;

    // 2. Parse alignments from the separator row
    // We do this manually because computeMarkdownTableCellRanges ignores the separator row.
    const separatorCells = parseSeparatorRow(lines[1]);
    const alignments = separatorCells.map(parseAlignment);

    // 3. Compute ranges for headers and body
    const ranges = computeMarkdownTableCellRanges(text);
    if (!ranges) {
        return null;
    }

    // 4. Extract content using the computed ranges
    const headers = ranges.headers.map((range) => text.slice(range.from, range.to));

    const rows = ranges.rows.map((rowRanges) => {
        return rowRanges.map((range) => text.slice(range.from, range.to));
    });

    return { headers, alignments, rows };
}

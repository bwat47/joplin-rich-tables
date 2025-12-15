import { isSeparatorRow, isUnescapedPipeAt } from './markdownTableCellRanges';

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
 * Parse a row of pipe-separated cells, respecting escaped pipes (\|).
 */
function parseRow(line: string): string[] {
    const trimmed = line.trim();

    // Find boundaries (same logic as parseLineCellRanges)
    let innerFrom = 0;
    let innerTo = trimmed.length;

    if (trimmed[innerFrom] === '|' && isUnescapedPipeAt(trimmed, innerFrom)) {
        innerFrom += 1;
    }
    if (innerTo > innerFrom && trimmed[innerTo - 1] === '|' && isUnescapedPipeAt(trimmed, innerTo - 1)) {
        innerTo -= 1;
    }

    // Find unescaped pipe delimiters
    const delimiters: number[] = [];
    for (let i = innerFrom; i < innerTo; i++) {
        if (isUnescapedPipeAt(trimmed, i)) {
            delimiters.push(i);
        }
    }

    // Extract cell contents
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
    const lines = text.split('\n').filter((line) => line.trim().length > 0);

    if (lines.length < 2) return null;

    // First line should be the header
    const headerLine = lines[0];
    if (!headerLine.includes('|')) return null;

    // Second line should be the separator
    const separatorLine = lines[1];
    if (!isSeparatorRow(separatorLine)) return null;

    const headers = parseRow(headerLine);
    const separatorCells = parseRow(separatorLine);
    const alignments = separatorCells.map(parseAlignment);

    // Parse data rows
    const rows: string[][] = [];
    for (let i = 2; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('|')) {
            rows.push(parseRow(line));
        }
    }

    return { headers, alignments, rows };
}

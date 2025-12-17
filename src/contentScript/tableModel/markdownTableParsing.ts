import { isSeparatorRow } from './markdownTableCellRanges';
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
 * Parse a row of pipe-separated cells, respecting escaped pipes (\|) and inline code.
 */
function parseRow(line: string): string[] {
    const trimmed = line.trim();

    // Get all pipe delimiters from the scanner
    const { delimiters: allDelimiters } = scanMarkdownTableRow(trimmed);

    // Find boundaries (same logic as parseLineCellRanges)
    let innerFrom = 0;
    let innerTo = trimmed.length;

    if (allDelimiters.length > 0 && allDelimiters[0] === 0) {
        innerFrom += 1;
    }
    if (allDelimiters.length > 0 && allDelimiters[allDelimiters.length - 1] === trimmed.length - 1) {
        innerTo -= 1;
    }

    // Filter delimiters to only those within the inner range
    const delimiters = allDelimiters.filter((i) => i > innerFrom && i < innerTo);

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

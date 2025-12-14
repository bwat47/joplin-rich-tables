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

export function isUnescapedPipeAt(line: string, index: number): boolean {
    if (line[index] !== '|') {
        return false;
    }

    let backslashCount = 0;
    for (let i = index - 1; i >= 0 && line[i] === '\\'; i--) {
        backslashCount++;
    }

    return backslashCount % 2 === 0;
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

    return { from: start, to: end };
}

function parseLineCellRanges(line: string, lineFromInTable: number): CellRange[] {
    const { from: trimFrom, to: trimTo } = findTrimBounds(line);
    if (trimTo <= trimFrom) {
        return [];
    }

    // Remove leading/trailing pipes after trimming whitespace.
    let innerFrom = trimFrom;
    let innerTo = trimTo;
    if (line[innerFrom] === '|' && isUnescapedPipeAt(line, innerFrom)) {
        innerFrom += 1;
    }
    if (innerTo > innerFrom && line[innerTo - 1] === '|' && isUnescapedPipeAt(line, innerTo - 1)) {
        innerTo -= 1;
    }

    const delimiters: number[] = [];
    for (let i = innerFrom; i < innerTo; i++) {
        if (line[i] === '|' && isUnescapedPipeAt(line, i)) {
            delimiters.push(i);
        }
    }

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

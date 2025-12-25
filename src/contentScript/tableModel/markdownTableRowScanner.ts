/**
 * Scans a markdown table row and returns indices of pipe delimiters.
 *
 * IMPORTANT: All table cell boundary logic MUST use this scanner. Do not split on '|' manually.
 *
 * Handles: escaped pipes (\|), pipes in inline code (`code`), unclosed backticks (as literals).
 * Does NOT handle: multi-backtick code spans (```code```), full markdown parsing.
 *
 * Compared to using Lezer's TableCell nodes, this scanner is more forgiving
 * (handles unescaped pipes in inline code, temporarily malformed tables during editing),
 * and handles all cells uniformly (including empty cells).
 *
 * Architecture:
 * 1. Lezer detects table blocks (Table/TableRow nodes)
 * 2. This scanner detects cell boundaries
 * 3. All plugin code uses this scanner (single source of truth)
 *
 */

export interface TableRowScanResult {
    readonly delimiters: number[];
}

export function scanMarkdownTableRow(line: string): TableRowScanResult {
    const delimiters: number[] = [];
    let isEscaped = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];

        if (isEscaped) {
            isEscaped = false;
            continue;
        }

        if (ch === '\\') {
            isEscaped = true;
            continue;
        }

        // Check for inline code span - only if there's a matching close
        if (ch === '`') {
            const closeIndex = findClosingBacktick(line, i + 1);
            if (closeIndex !== -1) {
                i = closeIndex; // Skip past the entire code span
                continue;
            }
            // No closing backtick - treat as literal, fall through
        }

        if (ch === '|') {
            delimiters.push(i);
        }
    }

    return { delimiters };
}

function findClosingBacktick(line: string, start: number): number {
    // Inside inline code spans, backslashes are NOT escape characters.
    // They are rendered literally: `\` displays as \
    for (let j = start; j < line.length; j++) {
        if (line[j] === '`') {
            return j;
        }
    }
    return -1; // Unmatched
}

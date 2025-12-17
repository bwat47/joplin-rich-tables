/**
 * Scans a markdown table row and returns indices of pipe characters
 * that act as cell delimiters.
 *
 * IMPORTANT: Any logic that reasons about table cell boundaries MUST use this scanner.
 * Do not split rows manually on '|'.
 *
 * Handles:
 * - Escaped pipes (\|) - not treated as delimiters
 * - Pipes inside inline code (`code`) - not treated as delimiters
 * - Unclosed backticks - treated as literal characters (matches Joplin renderer)
 *
 * Intentionally does NOT handle:
 * - Multi-backtick code spans (```code```)
 * - Full markdown parsing (emphasis, links, etc.)
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
    for (let j = start; j < line.length; j++) {
        if (line[j] === '\\' && j + 1 < line.length) {
            j++; // Skip escaped character
            continue;
        }
        if (line[j] === '`') {
            return j;
        }
    }
    return -1; // Unmatched
}

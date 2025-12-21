/**
 * Scans a markdown table row and returns indices of pipe delimiters.
 *
 * IMPORTANT: All table cell boundary logic MUST use this scanner. Do not split on '|' manually.
 *
 * Handles: escaped pipes (\|), pipes in inline code (`code`), unclosed backticks (as literals).
 * Does NOT handle: multi-backtick code spans (```code```), full markdown parsing.
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * WHY CUSTOM PARSING?
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Lezer's GFM parser provides TableCell nodes, however, it doesn't skip pipes
 * inside inline code when detecting cell boundaries. Example that breaks:
 *
 *   | `ls | grep` | Description |
 *
 * Lezer only handles backslash escapes (\|), not backtick-delimited code spans.
 * This scanner fixes that limitation and matches Joplin's rendering behavior.
 *
 * Architecture:
 * 1. Lezer detects table blocks (Table/TableRow nodes)
 * 2. This scanner detects cell boundaries (handles inline code correctly)
 * 3. All plugin code uses this scanner (single source of truth)
 *
 * Alternatives rejected:
 * - Lezer's TableCell nodes: Incorrect for cells with inline code
 * - Custom Lezer extension: Can't override Joplin's parser from plugin
 * - Regex/manual splitting: Fragile for edge cases
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

/**
 * Decides whether clipboard text is exactly one Markdown table block.
 *
 * Lezer owns the definition of a table block. This wrapper normalizes clipboard line
 * endings and padding, and rejects interior blank lines, before parsing exactly one
 * root-level table.
 */
import { MarkdownTable } from './MarkdownTable';
import { trimTablePaddingEnd } from '../shared/tablePadding';

/**
 * Splits on any line ending and drops trailing padding. The padding is invisible in a
 * clipboard payload, but Lezer refuses a delimiter row that carries it.
 */
function toNormalizedClipboardLines(text: string): string[] {
    return text.split(/\r\n?|\n/).map(trimTablePaddingEnd);
}

function isBlankLine(line: string): boolean {
    return line.trim().length === 0;
}

function trimOuterBlankLines(lines: string[]): string[] {
    let start = 0;
    let end = lines.length;

    while (start < end && isBlankLine(lines[start])) {
        start++;
    }

    while (end > start && isBlankLine(lines[end - 1])) {
        end--;
    }

    return lines.slice(start, end);
}

/**
 * Parses `text` only when it is a single table block, ignoring blank lines around it.
 * Returns null for anything else: multiple tables, a table split by a blank line, or a
 * table with text lines before or after it.
 */
export function parseSingleTableBlock(text: string): MarkdownTable | null {
    const lines = trimOuterBlankLines(toNormalizedClipboardLines(text));
    if (lines.length === 0) {
        return null;
    }

    // An interior blank line means the text spans more than one block.
    if (lines.some(isBlankLine)) {
        return null;
    }

    return MarkdownTable.parse(lines.join('\n'));
}

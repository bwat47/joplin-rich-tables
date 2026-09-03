/**
 * Decides whether clipboard text is exactly one Markdown table block.
 *
 * `MarkdownTable.parse()` drops blank lines before parsing, so text holding two tables
 * separated by a blank line parses as one table whose second header and separator row
 * become body rows. Every clipboard path needs the Markdown rule instead: a table block
 * ends at the first blank line, and nothing but table rows may sit inside it.
 */
import { MarkdownTable } from './MarkdownTable';

/** The separator row is the one block line that is not a table row. */
const SEPARATOR_ROW_LINE_COUNT = 1;

function normalizeClipboardLineEndings(text: string): string {
    return text.replace(/\r\n?/g, '\n');
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
    const lines = trimOuterBlankLines(normalizeClipboardLineEndings(text).split('\n'));
    if (lines.length === 0) {
        return null;
    }

    // An interior blank line means the text spans more than one block.
    if (lines.some(isBlankLine)) {
        return null;
    }

    const blockText = lines.join('\n');
    const table = MarkdownTable.parse(blockText);
    if (!table) {
        return null;
    }

    // `rowCount` counts the header plus body rows, so a block made only of table rows is
    // exactly that many lines plus the separator row.
    return lines.length === table.rowCount + SEPARATOR_ROW_LINE_COUNT ? table : null;
}

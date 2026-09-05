/**
 * Decides whether clipboard text is exactly one Markdown table block.
 *
 * Lezer owns the definition of a table block. This wrapper normalizes clipboard line
 * endings and delimiter-row padding, and rejects interior blank lines, before parsing exactly one
 * root-level table.
 */
import { MarkdownTable } from './MarkdownTable';
import { trimTablePaddingEnd } from '../shared/tablePadding';

/**
 * Splits on any line ending. Row content remains untouched until Lezer classifies it.
 */
function toClipboardLines(text: string): string[] {
    return text.split(/\r\n?|\n/);
}

const TABLE_DELIMITER_ROW_INDEX = 1;

/** Lezer 1.6.3 refuses a delimiter row that carries trailing ASCII padding. */
function normalizeDelimiterRowPadding(lines: readonly string[]): string[] {
    return lines.map((line, index) => (index === TABLE_DELIMITER_ROW_INDEX ? trimTablePaddingEnd(line) : line));
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
 * Returns null for anything else: multiple tables or a table split by a blank line.
 */
export function parseSingleTableBlock(text: string): MarkdownTable | null {
    const lines = trimOuterBlankLines(toClipboardLines(text));
    if (lines.length === 0) {
        return null;
    }

    // An interior blank line means the text spans more than one block.
    if (lines.some(isBlankLine)) {
        return null;
    }

    return MarkdownTable.parse(normalizeDelimiterRowPadding(lines).join('\n'));
}

const NON_CANONICAL_BR_PATTERN = /<br\s*\/>/gi;

export function normalizeBrTags(text: string): string {
    return text.replace(NON_CANONICAL_BR_PATTERN, '<br>');
}

const LINE_BREAK_PATTERN = /\r\n|\n|\r/g;
const UNESCAPED_PIPE_PATTERN = /(?<!\\)(\\\\)*\|/g;

/**
 * Converts arbitrary text into a value that is safe to store in a table cell: line breaks
 * become `<br>` and unescaped pipes are escaped, so neither can break out of the row.
 */
export function sanitizeLocalText(localText: string): string {
    return normalizeBrTags(localText).replace(LINE_BREAK_PATTERN, '<br>').replace(UNESCAPED_PIPE_PATTERN, '\\$&');
}

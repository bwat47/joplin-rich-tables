const NON_CANONICAL_BR_PATTERN = /<br\s*\/>/gi;
const LINE_BREAK_PATTERN = /\r\n|\n|\r/g;

export function normalizeBrTags(text: string): string {
    return text.replace(NON_CANONICAL_BR_PATTERN, '<br>');
}

export function convertNewlinesToBr(text: string): string {
    return text.replace(LINE_BREAK_PATTERN, '<br>');
}

/** Escapes pipes, accounting for a backslash run immediately before `text`. */
export function escapeUnescapedPipesWithContext(text: string, precedingBackslashes: number): string {
    let result = '';
    let backslashRun = precedingBackslashes;

    for (const ch of text) {
        if (ch === '\\') {
            result += ch;
            backslashRun++;
            continue;
        }

        if (ch === '|') {
            const isAlreadyEscaped = backslashRun % 2 === 1;
            result += isAlreadyEscaped ? '|' : '\\|';
            backslashRun = 0;
            continue;
        }

        result += ch;
        backslashRun = 0;
    }

    return result;
}

/** Escapes pipes in standalone text, where no preceding document context exists. */
export function escapeUnescapedPipes(text: string): string {
    return escapeUnescapedPipesWithContext(text, 0);
}

/**
 * Converts arbitrary text into a value that is safe to store in a table cell: line breaks
 * become `<br>` and unescaped pipes are escaped, so neither can break out of the row.
 *
 * `unsanitizeRootText` is the inverse; keep the two escaping conventions in sync.
 */
export function sanitizeLocalText(localText: string): string {
    return escapeUnescapedPipes(convertNewlinesToBr(normalizeBrTags(localText)));
}

/** Converts stored cell text back into display text for the nested editor. */
export function unsanitizeRootText(rootText: string): string {
    return rootText.split('<br>').join('\n').split('\\|').join('|');
}

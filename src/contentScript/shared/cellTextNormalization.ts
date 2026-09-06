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

/**
 * Stored spellings and the display text each becomes, longest first.
 *
 * The single source of truth for reading stored cell text: {@link unsanitizeRootText} produces
 * the text and {@link rootToLocalOffsets} the offsets that go with it, from one scan apiece over
 * this table, so the two cannot disagree about where a character went.
 */
const STORED_TO_DISPLAY: ReadonlyArray<readonly [stored: string, display: string]> = [
    ['<br>', '\n'],
    ['\\|', '|'],
];

/** The substitution `rootText` spells out at `index`, or null where it spells none. */
function substitutionAt(rootText: string, index: number): (typeof STORED_TO_DISPLAY)[number] | null {
    for (const substitution of STORED_TO_DISPLAY) {
        if (rootText.startsWith(substitution[0], index)) {
            return substitution;
        }
    }

    return null;
}

/** Converts stored cell text back into display text for the nested editor. */
export function unsanitizeRootText(rootText: string): string {
    let text = '';

    for (let index = 0; index < rootText.length;) {
        const substitution = substitutionAt(rootText, index);
        if (substitution) {
            text += substitution[1];
            index += substitution[0].length;
        } else {
            text += rootText[index];
            index++;
        }
    }

    return text;
}

/**
 * Display offset for every offset in `rootText`, including one past its end.
 *
 * Offsets inside a stored spelling all give the start of what it displays as: `<br>` is one
 * newline in the nested editor, so there is nowhere else in the display text for its middle to
 * be. Mapping a range therefore means reading both of its ends out of this array, rather than
 * running the text transform once per end as `editorBridge/cellTextCodec.ts` does for a
 * selection — the same answer, but built once for the whole cell.
 */
export function rootToLocalOffsets(rootText: string): Int32Array {
    const offsets = new Int32Array(rootText.length + 1);
    let local = 0;

    for (let index = 0; index < rootText.length;) {
        const substitution = substitutionAt(rootText, index);
        if (substitution) {
            offsets.fill(local, index, index + substitution[0].length);
            index += substitution[0].length;
            local += substitution[1].length;
        } else {
            offsets[index] = local;
            index++;
            local++;
        }
    }

    offsets[rootText.length] = local;
    return offsets;
}

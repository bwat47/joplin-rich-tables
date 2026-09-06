const NON_CANONICAL_BR_SOURCE = String.raw`<br\s*\/>`;
const LINE_BREAK_SOURCE = String.raw`\r\n|\n|\r`;

const NON_CANONICAL_BR_PATTERN = new RegExp(NON_CANONICAL_BR_SOURCE, 'gi');
const LINE_BREAK_PATTERN = new RegExp(LINE_BREAK_SOURCE, 'g');

/** Sticky twins of the patterns above, for matching one run at a known offset. */
const NON_CANONICAL_BR_AT_PATTERN = new RegExp(NON_CANONICAL_BR_SOURCE, 'iy');
const LINE_BREAK_AT_PATTERN = new RegExp(LINE_BREAK_SOURCE, 'y');

const CANONICAL_BR = '<br>';
const ESCAPED_PIPE = String.raw`\|`;

export function normalizeBrTags(text: string): string {
    return text.replace(NON_CANONICAL_BR_PATTERN, CANONICAL_BR);
}

export function convertNewlinesToBr(text: string): string {
    return text.replace(LINE_BREAK_PATTERN, CANONICAL_BR);
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
            result += isAlreadyEscaped ? '|' : ESCAPED_PIPE;
            backslashRun = 0;
            continue;
        }

        result += ch;
        backslashRun = 0;
    }

    return result;
}

/** The text `pattern` spells out at `index`, or null where it matches nothing there. */
function matchAt(pattern: RegExp, text: string, index: number): string | null {
    pattern.lastIndex = index;
    return pattern.exec(text)?.[0] ?? null;
}

/**
 * Walks `localText` as the runs it is stored as, handing each run's source length and stored
 * spelling to `visit`.
 *
 * The single source of truth for writing cell text: {@link sanitizeLocalText} produces the text
 * and {@link localToRootOffsets} the offsets that go with it, from one walk apiece over this
 * scan, so the two cannot disagree about where a character went. One walk stands in for
 * normalizing break tags, converting newlines and escaping pipes in sequence, because neither
 * rewrite emits a newline or a pipe for a later pass to act on, and a `<br>` it writes ends the
 * backslash run exactly as that tag's four characters would.
 *
 * Runs are single UTF-16 code units, so an astral character is walked as its two halves and
 * offsets stay in the units CodeMirror counts.
 */
function scanLocalRuns(localText: string, visit: (index: number, consumed: number, stored: string) => void): void {
    let backslashRun = 0;

    for (let index = 0; index < localText.length;) {
        const lineBreak =
            matchAt(NON_CANONICAL_BR_AT_PATTERN, localText, index) ?? matchAt(LINE_BREAK_AT_PATTERN, localText, index);
        if (lineBreak !== null) {
            visit(index, lineBreak.length, CANONICAL_BR);
            index += lineBreak.length;
            backslashRun = 0;
            continue;
        }

        const char = localText[index];
        if (char === '|') {
            visit(index, 1, backslashRun % 2 === 1 ? '|' : ESCAPED_PIPE);
            backslashRun = 0;
        } else {
            visit(index, 1, char);
            backslashRun = char === '\\' ? backslashRun + 1 : 0;
        }
        index++;
    }
}

/**
 * Converts arbitrary text into a value that is safe to store in a table cell: line breaks
 * become `<br>` and unescaped pipes are escaped, so neither can break out of the row.
 *
 * {@link unsanitizeRootText} is the inverse; the two scans they read from carry the same
 * escaping conventions, so keep the tables in sync.
 */
export function sanitizeLocalText(localText: string): string {
    let rootText = '';

    scanLocalRuns(localText, (_index, _consumed, stored) => {
        rootText += stored;
    });

    return rootText;
}

/**
 * Stored offset for every offset in `localText`, including one past its end.
 *
 * Offsets inside display text that is stored as something else all give the start of its stored
 * spelling: a newline is written `<br>`, so a caret cannot be halfway through it, and a caret
 * before a pipe lands before the backslash that escapes it. Mapping a range reads both ends from
 * this array, built once for the whole cell.
 */
export function localToRootOffsets(localText: string): Int32Array {
    const offsets = new Int32Array(localText.length + 1);
    let root = 0;

    scanLocalRuns(localText, (index, consumed, stored) => {
        offsets.fill(root, index, index + consumed);
        root += stored.length;
    });

    offsets[localText.length] = root;
    return offsets;
}

/**
 * Stored spellings and the display text each becomes, longest first.
 *
 * The single source of truth for reading stored cell text: {@link unsanitizeRootText} produces
 * the text and {@link rootToLocalOffsets} the offsets that go with it, from one scan apiece over
 * this table, so the two cannot disagree about where a character went.
 */
const STORED_TO_DISPLAY: ReadonlyArray<readonly [stored: string, display: string]> = [
    [CANONICAL_BR, '\n'],
    [ESCAPED_PIPE, '|'],
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
 * be. Mapping a range reads both ends from this array, built once for the whole cell.
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

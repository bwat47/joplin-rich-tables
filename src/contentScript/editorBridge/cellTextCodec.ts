import { Transaction } from '@codemirror/state';
import { normalizeBrTags } from '../shared/cellTextNormalization';
import { clamp } from '../shared/numberUtils';

export interface LocalSelection {
    anchor: number;
    head: number;
}

/** A simple change spec for building sanitized transactions. */
type SimpleChange = { from: number; to: number; insert: string };

/** Result of sanitizing cell changes. */
export interface SanitizeChangesResult {
    rejected: boolean;
    didModifyInserts: boolean;
    changes: SimpleChange[];
}

const SELECTION_MARK = '\u{0}';
const UNESCAPED_PIPE_PATTERN = /(?<!\\)(\\\\)*\|/g;
const LINE_BREAK_PATTERN = /\r\n|\n|\r/g;

export function escapeUnescapedPipes(text: string): string {
    return escapeUnescapedPipesWithContext(text, 0);
}

function escapeUnescapedPipesWithContext(text: string, precedingBackslashes: number): string {
    let result = '';
    let backslashRun = precedingBackslashes;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\\') {
            result += ch;
            backslashRun++;
            continue;
        }

        if (ch === '|') {
            const isAlreadyEscaped = backslashRun % 2 === 1;
            result += isAlreadyEscaped ? '|' : String.raw`\|`;
            backslashRun = 0;
            continue;
        }

        result += ch;
        backslashRun = 0;
    }

    return result;
}

export function convertNewlinesToBr(text: string): string {
    return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\n', '<br>');
}

export function unsanitizeRootText(rootText: string): string {
    return rootText
        .replaceAll('<br>', '\n')
        .split(String.raw`\|`)
        .join('|');
}

export function sanitizeLocalText(localText: string): string {
    return normalizeBrTags(localText)
        .replaceAll(LINE_BREAK_PATTERN, '<br>')
        .replaceAll(UNESCAPED_PIPE_PATTERN, String.raw`\$&`);
}

function toSpan(selection: LocalSelection): { from: number; to: number; forward: boolean } {
    return {
        from: Math.min(selection.anchor, selection.head),
        to: Math.max(selection.anchor, selection.head),
        forward: selection.anchor <= selection.head,
    };
}

function clampSelection(selection: LocalSelection, textLength: number): LocalSelection {
    return {
        anchor: clamp(selection.anchor, 0, textLength),
        head: clamp(selection.head, 0, textLength),
    };
}

function mapSelectionThroughTransform(
    selection: LocalSelection,
    text: string,
    transform: (value: string) => string
): LocalSelection {
    const { from, to, forward } = toSpan(selection);
    const marked = `${text.slice(0, from)}${SELECTION_MARK}${text.slice(from, to)}${SELECTION_MARK}${text.slice(to)}`;
    const transformed = transform(marked);
    const mappedFrom = transformed.indexOf(SELECTION_MARK);
    const mappedTo = transformed.lastIndexOf(SELECTION_MARK) - 1;
    if (mappedFrom === -1 || mappedTo < -1) {
        return { anchor: 0, head: 0 };
    }

    return forward ? { anchor: mappedFrom, head: mappedTo } : { anchor: mappedTo, head: mappedFrom };
}

export function toRootSelection(localSelection: LocalSelection, localText: string): LocalSelection {
    return clampSelection(
        mapSelectionThroughTransform(localSelection, localText, sanitizeLocalText),
        sanitizeLocalText(localText).length
    );
}

export function toLocalSelection(rootSelection: LocalSelection, rootText: string): LocalSelection {
    return clampSelection(
        mapSelectionThroughTransform(rootSelection, rootText, unsanitizeRootText),
        unsanitizeRootText(rootText).length
    );
}

function countTrailingBackslashesInDoc(doc: Transaction['startState']['doc'], pos: number): number {
    let count = 0;
    for (let i = pos - 1; i >= 0; i--) {
        if (doc.sliceString(i, i + 1) !== '\\') {
            break;
        }
        count++;
    }
    return count;
}

/**
 * Sanitizes transaction changes for direct main-editor edits inside the active cell.
 * - Rejects changes that touch outside the cell bounds
 * - Converts newlines to `<br>` tags
 * - Escapes unescaped pipe characters
 */
export function sanitizeCellChanges(tr: Transaction, cellFrom: number, cellTo: number): SanitizeChangesResult {
    const changes: SimpleChange[] = [];
    let rejected = false;
    let didModifyInserts = false;

    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        if (fromA < cellFrom || toA > cellTo) {
            rejected = true;
            return;
        }

        const insertedText = inserted.toString();
        let sanitized = normalizeBrTags(insertedText);

        if (sanitized.includes('\n') || sanitized.includes('\r')) {
            sanitized = convertNewlinesToBr(sanitized);
        }

        if (sanitized.includes('|')) {
            sanitized = escapeUnescapedPipesWithContext(
                sanitized,
                countTrailingBackslashesInDoc(tr.startState.doc, fromA)
            );
        }

        if (sanitized !== insertedText) {
            didModifyInserts = true;
        }

        changes.push({ from: fromA, to: toA, insert: sanitized });
    });

    return { rejected, didModifyInserts, changes };
}

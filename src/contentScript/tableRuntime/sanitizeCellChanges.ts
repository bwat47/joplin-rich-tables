import type { Transaction } from '@codemirror/state';
import {
    convertNewlinesToBr,
    escapeUnescapedPipesWithContext,
    normalizeBrTags,
} from '../tableModel/cellTextNormalization';

/** A simple change spec for building sanitized transactions. */
type SimpleChange = { from: number; to: number; insert: string };

/** Result of sanitizing cell changes. */
export interface SanitizeChangesResult {
    rejected: boolean;
    didModifyInserts: boolean;
    changes: SimpleChange[];
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

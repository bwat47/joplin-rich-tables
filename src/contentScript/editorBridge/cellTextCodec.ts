import { Transaction } from '@codemirror/state';
import {
    convertNewlinesToBr,
    escapeUnescapedPipesWithContext,
    localToRootOffsets,
    normalizeBrTags,
    rootToLocalOffsets,
} from '../shared/cellTextNormalization';
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

/**
 * Reads both endpoints out of an offset map built once for the whole cell.
 *
 * Each endpoint is mapped on its own, so a backward selection stays backward, and every value
 * the map holds is a real offset in the text it maps into - the map never needs the text it
 * measures to be altered first, so there is nothing to clamp away afterwards.
 */
function mapSelection(selection: LocalSelection, offsets: Int32Array): LocalSelection {
    const lastOffset = offsets.length - 1;
    return {
        anchor: offsets[clamp(selection.anchor, 0, lastOffset)],
        head: offsets[clamp(selection.head, 0, lastOffset)],
    };
}

export function toRootSelection(localSelection: LocalSelection, localText: string): LocalSelection {
    return mapSelection(localSelection, localToRootOffsets(localText));
}

export function toLocalSelection(rootSelection: LocalSelection, rootText: string): LocalSelection {
    return mapSelection(rootSelection, rootToLocalOffsets(rootText));
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

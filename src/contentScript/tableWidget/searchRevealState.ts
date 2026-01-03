/**
 * State management for revealing tables as raw markdown during search.
 *
 * When the search panel is open and the cursor navigates to a match inside a table,
 * that table is "revealed" (shown as raw markdown) so CodeMirror's native search
 * highlighting works. When search closes or cursor moves out, the table re-renders.
 */
import { StateField, StateEffect, EditorState } from '@codemirror/state';

/**
 * Effect to set which table should be revealed (shown as raw markdown).
 * Pass null to clear the reveal state.
 */
export const setRevealedTableEffect = StateEffect.define<number | null>();

/**
 * StateField tracking which table (by `from` position) is currently revealed.
 * null means no table is revealed (all tables render as widgets).
 */
export const searchRevealedTableField = StateField.define<number | null>({
    create: () => null,

    update(revealedFrom, transaction) {
        // Check for explicit reveal/clear effects
        for (const effect of transaction.effects) {
            if (effect.is(setRevealedTableEffect)) {
                return effect.value;
            }
        }

        // Map position through document changes
        if (revealedFrom !== null && transaction.docChanged) {
            // Use assoc=1 so insertions at the start don't push us away
            const mapped = transaction.changes.mapPos(revealedFrom, 1);
            // If the position was deleted, clear the reveal
            if (mapped === revealedFrom && transaction.changes.touchesRange(revealedFrom, revealedFrom + 1)) {
                return null;
            }
            return mapped;
        }

        return revealedFrom;
    },
});

/**
 * Get the currently revealed table position, or null if none.
 */
export function getRevealedTable(state: EditorState): number | null {
    return state.field(searchRevealedTableField, false) ?? null;
}

/**
 * Search override for table rendering.
 *
 * When the search panel is open, we temporarily force all tables to render as raw markdown
 * (i.e., disable table widgets) so CodeMirror's native search highlighting works reliably.
 *
 * This is intentionally separate from the user-controlled source mode toggle.
 */
import { StateEffect, StateField, type EditorState } from '@codemirror/state';

/** Sets whether search is forcing tables to render as raw markdown. */
export const setSearchForceSourceModeEffect = StateEffect.define<boolean>();

/**
 * Effect dispatched when the search-forced raw mode is exited.
 * Used by view plugins to perform side effects (e.g., re-activating the cell at the cursor).
 */
export const exitSearchForceSourceModeEffect = StateEffect.define<void>();

/** StateField tracking whether search is forcing raw markdown table rendering. */
export const searchForceSourceModeField = StateField.define<boolean>({
    create: () => false,

    update(current, transaction) {
        for (const effect of transaction.effects) {
            if (effect.is(setSearchForceSourceModeEffect)) {
                return effect.value;
            }
        }
        return current;
    },
});

export function isSearchForceSourceModeEnabled(state: EditorState): boolean {
    return state.field(searchForceSourceModeField, false) ?? false;
}

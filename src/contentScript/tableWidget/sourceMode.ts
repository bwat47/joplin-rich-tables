/**
 * Source mode toggle for tables.
 *
 * When enabled, all tables are shown as raw markdown instead of widgets.
 * Useful for debugging or manual table editing.
 */
import { StateField, StateEffect, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * Effect to toggle source mode on/off.
 */
export const toggleSourceModeEffect = StateEffect.define<boolean>();

/**
 * StateField tracking whether source mode is enabled.
 */
export const sourceModeField = StateField.define<boolean>({
    create: () => false,

    update(isSourceMode, transaction) {
        for (const effect of transaction.effects) {
            if (effect.is(toggleSourceModeEffect)) {
                return effect.value;
            }
        }
        return isSourceMode;
    },
});

/**
 * Check if source mode is currently enabled.
 */
export function isSourceModeEnabled(state: EditorState): boolean {
    return state.field(sourceModeField, false) ?? false;
}

/**
 * Toggle source mode on/off.
 */
export function toggleSourceMode(view: EditorView): boolean {
    const current = isSourceModeEnabled(view.state);
    view.dispatch({ effects: toggleSourceModeEffect.of(!current) });
    return true;
}

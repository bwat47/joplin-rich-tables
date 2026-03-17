import { StateField, StateEffect, type EditorState } from '@codemirror/state';
import { isSearchForceSourceModeEnabled } from './searchForceSourceMode';

/**
 * Effect to toggle source mode on/off.
 */
export const toggleSourceModeEffect = StateEffect.define<boolean>();

/**
 * Effect dispatched when source mode is exited (toggled off).
 * Used by view plugins to perform side effects (e.g., re-activating the cell at the cursor).
 */
export const exitSourceModeEffect = StateEffect.define<void>();

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
 * Check if tables are currently in "raw markdown" mode.
 * This is true when either user source mode or search-forced mode is enabled.
 */
export function isEffectiveRawMode(state: EditorState): boolean {
    return isSourceModeEnabled(state) || isSearchForceSourceModeEnabled(state);
}

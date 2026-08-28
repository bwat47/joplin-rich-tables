import type { StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { clearActiveCellEffect, getActiveCell } from '../tableState/activeCellState';
import { isSearchForceSourceModeEnabled } from '../tableState/searchForceSourceMode';
import { exitSourceModeEffect, isSourceModeEnabled, toggleSourceModeEffect } from '../tableState/sourceMode';
import { requestViewAnimationFrame } from '../shared/domContext';

function focusMainEditorForExplicitSourceModeEntry(view: EditorView): void {
    requestViewAnimationFrame(view, () => {
        if (!view.dom.isConnected) {
            return;
        }

        // Search-forced raw mode intentionally lets Joplin keep focus on the search UI.
        if (!isSourceModeEnabled(view.state) || isSearchForceSourceModeEnabled(view.state)) {
            return;
        }

        view.focus();
    });
}

export function toggleSourceMode(view: EditorView): boolean {
    const current = isSourceModeEnabled(view.state);
    const enteringSourceMode = !current;

    if (enteringSourceMode) {
        const effects: StateEffect<unknown>[] = [toggleSourceModeEffect.of(true)];
        if (getActiveCell(view.state)) {
            effects.unshift(clearActiveCellEffect.of(undefined));
        }
        view.dispatch({ effects });
        focusMainEditorForExplicitSourceModeEntry(view);
        return true;
    }

    view.dispatch({
        effects: [toggleSourceModeEffect.of(false), exitSourceModeEffect.of(undefined)],
    });
    return true;
}

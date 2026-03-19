import type { StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { clearActiveCellEffect, getActiveCell } from '../tableState/activeCellState';
import { exitSourceModeEffect, isSourceModeEnabled, toggleSourceModeEffect } from '../tableState/sourceMode';

export function toggleSourceMode(view: EditorView): boolean {
    const current = isSourceModeEnabled(view.state);
    const enteringSourceMode = !current;

    if (enteringSourceMode) {
        const effects: StateEffect<unknown>[] = [toggleSourceModeEffect.of(true)];
        if (getActiveCell(view.state)) {
            effects.unshift(clearActiveCellEffect.of(undefined));
        }
        view.dispatch({ effects });
        return true;
    }

    view.dispatch({
        effects: [toggleSourceModeEffect.of(false), exitSourceModeEffect.of(undefined)],
    });
    return true;
}

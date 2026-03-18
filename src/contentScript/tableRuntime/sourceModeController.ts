import { EditorView } from '@codemirror/view';
import { exitSourceModeEffect, isSourceModeEnabled, toggleSourceModeEffect } from '../tableState/sourceMode';
import { clearActiveCell } from './activeCellController';

export function toggleSourceMode(view: EditorView): boolean {
    const current = isSourceModeEnabled(view.state);
    const enteringSourceMode = !current;

    if (enteringSourceMode) {
        clearActiveCell(view, {
            reason: 'source-mode-enter',
            closeNestedEditor: true,
        });
    }

    view.dispatch({
        effects: enteringSourceMode
            ? [toggleSourceModeEffect.of(true)]
            : [toggleSourceModeEffect.of(false), exitSourceModeEffect.of(undefined)],
    });
    return true;
}

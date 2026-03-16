import { EditorView } from '@codemirror/view';
import { clearActiveCellEffect, getActiveCell } from '../tableState/activeCellState';
import { exitSourceModeEffect, isSourceModeEnabled, toggleSourceModeEffect } from '../tableState/sourceMode';
import { closeNestedCellEditor, isNestedCellEditorOpen } from '../nestedEditor/nestedCellEditor';

export function toggleSourceMode(view: EditorView): boolean {
    const current = isSourceModeEnabled(view.state);
    const enteringSourceMode = !current;

    if (enteringSourceMode) {
        if (isNestedCellEditorOpen(view)) {
            closeNestedCellEditor(view);
        }
        if (getActiveCell(view.state)) {
            view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
        }
    }

    view.dispatch({
        effects: enteringSourceMode
            ? [toggleSourceModeEffect.of(true)]
            : [toggleSourceModeEffect.of(false), exitSourceModeEffect.of(undefined)],
    });
    return true;
}

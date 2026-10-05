import { EditorView } from '@codemirror/view';
import { getActiveCell } from '../tableState/activeCellState';
import { getNestedEditorPort } from '../tableRuntime/nestedEditorPort';

/**
 * Defensive focus handler that reclaims focus for the nested editor when it's
 * unexpectedly stolen (e.g., by Android's focus management after toolbar commands).
 */
export const nestedEditorFocusGuard = EditorView.domEventHandlers({
    focus: (_event, view) => {
        // If the nested editor is open and should have focus, reclaim it.
        // This handles cases where Android or other focus management systems
        // redirect focus to the main editor after toolbar button presses.
        const nestedEditor = getNestedEditorPort(view);
        if (nestedEditor.isOpen(view) && getActiveCell(view.state)) {
            nestedEditor.refocus(view);
            return true;
        }
        return false;
    },
});

import { EditorView } from '@codemirror/view';
import { resolveContainingTableAtPos } from '../tableResolution';

export function moveCursorOutOfTable(view: EditorView, offset = 1): boolean {
    const cursor = view.state.selection.main.head;
    const tableContainingCursor = resolveContainingTableAtPos(view.state, cursor);
    if (!tableContainingCursor) {
        return false;
    }

    // Place cursor right after the table (start of next line).
    const newPos = Math.min(tableContainingCursor.to + offset, view.state.doc.length);
    view.dispatch({ selection: { anchor: newPos } });
    return true;
}

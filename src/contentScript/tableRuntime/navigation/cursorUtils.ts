import { EditorView } from '@codemirror/view';
import { getTableContextAtPos } from '../../tableState/tableContextField';

export function moveCursorOutOfTable(view: EditorView, offset = 1): boolean {
    const cursor = view.state.selection.main.head;
    const tableContainingCursor = getTableContextAtPos(view.state, cursor);
    if (!tableContainingCursor) {
        return false;
    }

    // Place cursor right after the table (start of next line).
    const newPos = Math.min(tableContainingCursor.to + offset, view.state.doc.length);
    view.dispatch({ selection: { anchor: newPos } });
    return true;
}

import { EditorView } from '@codemirror/view';
import { findTableRanges } from './tablePositioning';

export function moveCursorOutOfTable(view: EditorView, offset: number = 2): boolean {
    const tables = findTableRanges(view.state);
    const cursor = view.state.selection.main.head;
    const tableContainingCursor = tables.find((t) => cursor >= t.from && cursor <= t.to);
    if (!tableContainingCursor) {
        return false;
    }

    // Place cursor after the table to avoid landing inside a rendered widget.
    const newPos = Math.min(tableContainingCursor.to + offset, view.state.doc.length);
    view.dispatch({ selection: { anchor: newPos } });
    return true;
}

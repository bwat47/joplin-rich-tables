import { EditorSelection, type SelectionRange } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * Start of the visual (wrapped) row that `range` is drawn on.
 *
 * `moveToLineBoundary` respects `assoc`, so a caret at a wrap point is attributed to the
 * row it is drawn on. It only measures wrapped rows when the view has `lineWrapping`
 * enabled; without layout (notably under jsdom) it falls back to the logical line start.
 */
function visualRowStart(view: EditorView, range: SelectionRange): number {
    return view.moveToLineBoundary(range, false).head;
}

/** True when the caret sits on the same visual row as `boundary`. */
function isCaretOnSameVisualRowAs(view: EditorView, boundary: SelectionRange): boolean {
    return visualRowStart(view, view.state.selection.main) === visualRowStart(view, boundary);
}

/** True when the caret sits on the first visual (wrapped) line of the document. */
export function isCaretOnFirstVisualLine(view: EditorView): boolean {
    return isCaretOnSameVisualRowAs(view, EditorSelection.cursor(0, 1));
}

/** True when the caret sits on the last visual (wrapped) line of the document. */
export function isCaretOnLastVisualLine(view: EditorView): boolean {
    return isCaretOnSameVisualRowAs(view, EditorSelection.cursor(view.state.doc.length, -1));
}

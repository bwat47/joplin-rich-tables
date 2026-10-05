import type { EditorView } from '@codemirror/view';

/** Vertical tolerance (px) for treating two caret rects as the same visual line. */
const SAME_VISUAL_LINE_TOLERANCE_PX = 2;

/**
 * True when the caret sits on the same visual (wrapped) line as `pos`.
 *
 * `coordsAtPos` returns null when the view is not laid out (notably under jsdom),
 * so the exact-position check is both the fast path and the measurement fallback.
 */
export function isCaretOnSameVisualLine(view: EditorView, pos: number): boolean {
    const { head } = view.state.selection.main;
    if (head === pos) {
        return true;
    }

    const headRect = view.coordsAtPos(head);
    const posRect = view.coordsAtPos(pos);
    if (!headRect || !posRect) {
        return false;
    }

    return Math.abs(headRect.top - posRect.top) < SAME_VISUAL_LINE_TOLERANCE_PX;
}

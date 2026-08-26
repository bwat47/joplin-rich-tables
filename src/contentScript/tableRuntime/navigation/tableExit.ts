import type { StateEffect } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { ResolvedTable } from '../../tableModel/types';

/** Which side of a table the caret leaves through. */
export type TableExitSide = 'before' | 'after';

/**
 * Moves the caret to the line adjacent to a table, applies `effects`, and hands focus
 * back to the main editor. Returns false when the table sits against a document edge
 * and there is no adjacent line, leaving the caller to decide what to do instead.
 *
 * Focus must be restored with `view.focus()`, not a bare `contentDOM.focus()`. Callers
 * reach this while the caret is parked inside the table's replaced range — often with a
 * nested editor still holding focus — so CodeMirror has not written the new selection to
 * the DOM (it only controls the DOM selection while focused). `view.focus()` suppresses
 * the DOM observer across the focus call and syncs the DOM selection from state; focusing
 * the content element directly lets the observer read the stale DOM selection back and
 * jump the caret to an unrelated part of the document. `view.focus()` prevents scrolling
 * internally, so the viewport still stays put.
 */
export function exitTableToAdjacentLine(
    view: EditorView,
    table: Pick<ResolvedTable, 'from' | 'to'>,
    side: TableExitSide,
    effects: StateEffect<unknown>[]
): boolean {
    const exitPos = side === 'before' ? table.from - 1 : table.to + 1;
    if (exitPos < 0 || exitPos > view.state.doc.length) {
        return false;
    }

    view.dispatch({
        selection: { anchor: exitPos },
        effects,
        scrollIntoView: true,
    });
    view.focus();

    return true;
}

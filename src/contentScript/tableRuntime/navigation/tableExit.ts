import type { EditorState, StateEffect } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import type { TableSpan } from '../../tableModel/tableContext';
import { getTableContextAtPos } from '../../tableState/tableContextField';

/** Which side of a table the caret leaves through. */
export type TableExitSide = 'before' | 'after';

/**
 * Moves the caret to the line adjacent to a table, applies `effects`, and hands focus
 * back to the main editor. Returns false when the table sits against a document edge
 * and there is no adjacent line, leaving the caller to decide what to do instead.
 */
export function exitTableToAdjacentLine(
    view: EditorView,
    table: TableSpan,
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

/**
 * Where the main cursor should go to leave the table containing it, or null when the cursor
 * is not inside a table. The position is right after the table (start of the next line).
 */
export function getPositionOutsideTable(state: EditorState): number | null {
    const tableContainingCursor = getTableContextAtPos(state, state.selection.main.head);
    if (!tableContainingCursor) {
        return null;
    }

    return Math.min(tableContainingCursor.to + 1, state.doc.length);
}

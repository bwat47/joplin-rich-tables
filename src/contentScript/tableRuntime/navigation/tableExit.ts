import type { StateEffect } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { ResolvedTable } from '../../tableModel/types';

/** Which side of a table the caret leaves through. */
export type TableExitSide = 'before' | 'after';

/**
 * Moves the caret to the line adjacent to a table, applies `effects`, and hands focus
 * back to the main editor. Returns false when the table sits against a document edge
 * and there is no adjacent line, leaving the caller to decide what to do instead.
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

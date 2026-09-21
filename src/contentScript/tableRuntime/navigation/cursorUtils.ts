import type { EditorState } from '@codemirror/state';
import { getTableContextAtPos } from '../../tableState/tableContextField';

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

import { EditorState, Extension, Facet, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { clearActiveCellEffect, getActiveCell } from './activeCellState';
import { closeNestedCellEditor, isNestedCellEditorOpen } from '../nestedEditor/nestedCellEditor';
import { moveCursorOutOfTable } from './cursorUtils';
import { logger } from '../../logger';

/**
 * Facet for accessing the current note ID from Joplin's editor extensions.
 */
type NoteIdFacet = Facet<string, string>;

/**
 * Creates an extension that watches for note ID changes and closes nested editors.
 * When the note ID changes (user switched notes), any open nested editor is closed
 * to prevent stale editor state, and the cursor is moved out of any table.
 *
 * This is handled in the content script rather than the main plugin because:
 * 1. No need to check if CodeMirror is active (this only runs when it is)
 * 2. Cleaner architecture - table logic stays in the content script
 * 3. Synchronous detection within the transaction system
 *
 * Modified from: https://github.com/personalizedrefrigerator/joplin-plugin-diff-tool (watchForNoteIdChanges.ts)
 */
export function createNoteIdWatcher(noteIdFacet: NoteIdFacet, getView: () => EditorView): Extension {
    let lastNoteId: string | null = null;

    return EditorState.transactionExtender.of((tr: Transaction) => {
        const currentId = tr.state.facet(noteIdFacet);

        // Initialize on first transaction
        if (lastNoteId === null) {
            lastNoteId = currentId;
            return null;
        }

        if (lastNoteId !== currentId) {
            logger.debug('Note ID changed:', { from: lastNoteId, to: currentId });
            lastNoteId = currentId;

            const view = getView();
            const hasActiveCell = getActiveCell(tr.startState) !== null;

            // Close nested editor if open (schedule for after transaction completes) to prevent potential stale editor state.
            // This is more of a defensive cleanup - it formally destroys the nested editor instance (if it exists).
            // But by the time this runs, the stale state is already gone because
            // The clearActiveCellEffect already cleared the active cell and
            // The full document replacement from switching notes already triggered a decoration rebuild in tableWidgetExtension.ts.
            if (isNestedCellEditorOpen(view)) {
                setTimeout(() => {
                    closeNestedCellEditor(view);
                    logger.debug('Closed nested editor on note switch');
                }, 0);
            }

            // Move cursor out of table if inside one (prevents state where cursor is inside
            // rendered table widget when Joplin restores cursor position on note switch).
            // Schedule for after transaction completes since we can't dispatch during
            // a transaction extender.
            setTimeout(() => {
                const moved = moveCursorOutOfTable(view);
                if (moved) {
                    logger.debug('Moved cursor out of table on note switch');
                }
            }, 0);

            // Clear active cell state
            if (hasActiveCell) {
                return { effects: clearActiveCellEffect.of(undefined) };
            }
        }

        return null;
    });
}

import { EditorState, Extension, Facet, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { clearActiveCellEffect, getActiveCell } from '../tableState/activeCellState';
import { moveCursorOutOfTable } from './cursorUtils';
import { logger } from '../../logger';

/**
 * Facet for accessing the current note ID from Joplin's editor extensions.
 */
type NoteIdFacet = Facet<string, string>;

/**
 * Creates an extension that watches for note ID changes and clears any active table state.
 * When the note ID changes (user switched notes), the lifecycle plugin closes the nested
 * editor in response to the cleared active cell and the cursor is moved out of any table.
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

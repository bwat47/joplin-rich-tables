import { Extension, Facet } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { clearActiveCellEffect, getActiveCell } from '../tableState/activeCellState';
import { moveCursorOutOfTable } from './navigation/cursorUtils';
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
    return ViewPlugin.fromClass(
        class {
            update(update: ViewUpdate): void {
                const previousId = update.startState.facet(noteIdFacet);
                const currentId = update.state.facet(noteIdFacet);
                if (previousId === currentId) {
                    return;
                }

                logger.debug('Note ID changed:', { from: previousId, to: currentId });

                // Run after the note-switch update has settled. Keeping facet inspection in a
                // view update avoids forcing `tr.state` from a transaction extender, which would
                // construct and then discard a provisional state when another extender contributes.
                setTimeout(() => {
                    const view = getView();
                    const moved = moveCursorOutOfTable(view);
                    if (moved) {
                        logger.debug('Moved cursor out of table on note switch');
                    }
                    if (getActiveCell(view.state)) {
                        view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                    }
                }, 0);
            }
        }
    );
}

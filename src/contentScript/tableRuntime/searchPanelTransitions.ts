/**
 * Synchronous lifecycle effects for CodeMirror search-panel open and close.
 *
 * Search-forced raw mode is `searchPanelOpen(state)` itself. This extender only attaches the
 * side effects that have to ride the same transaction: clearing the active cell on open, and
 * signalling search exit on close.
 */
import { searchPanelOpen } from '@codemirror/search';
import { EditorState, StateEffect, type Extension, type Transaction, type TransactionSpec } from '@codemirror/state';
import { clearActiveCellEffect, getActiveCell } from '../tableState/activeCellState';

/**
 * Effect dispatched when search-forced raw mode is exited.
 * View plugins use it to reactivate the cell at the cursor.
 */
export const exitSearchForceSourceModeEffect = StateEffect.define<null>();


function extendSearchPanelTransition(transaction: Transaction): Pick<TransactionSpec, 'effects'> | null {
    // Panel visibility changes only through state effects, so a document-only transaction cannot
    // be an open or close. Leaving it untouched also avoids computing the resulting state here.
    if (transaction.effects.length === 0) {
        return null;
    }

    const wasOpen = searchPanelOpen(transaction.startState);
    const isOpen = searchPanelOpen(transaction.state);
    if (wasOpen === isOpen) {
        return null;
    }

    if (isOpen) {
        return getActiveCell(transaction.state) ? { effects: clearActiveCellEffect.of(null) } : null;
    }

    return { effects: exitSearchForceSourceModeEffect.of(null) };
}

/** Attaches search open/close lifecycle effects to the transaction that changes the panel. */
export const searchPanelTransitionExtension: Extension =
    EditorState.transactionExtender.of(extendSearchPanelTransition);

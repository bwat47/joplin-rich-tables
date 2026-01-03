/**
 * Watches for Joplin's search panel open/close transitions.
 * - On open: closes nested editor and reveals table at cursor (raw markdown)
 * - While open: updates revealed table as cursor moves between tables
 * - On close: clears reveal state and activates cell if cursor is in table
 *
 * This enables CodeMirror's native search highlighting to work on table content
 * while the search panel is open.
 */
import { StateField, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { searchPanelOpen } from '@codemirror/search';
import { clearActiveCellEffect, getActiveCell } from './activeCellState';
import { closeNestedCellEditor, isNestedCellEditorOpen } from '../nestedEditor/nestedCellEditor';
import { activateCellAtPosition } from './cellActivation';
import { resolveTableAtPos } from './tablePositioning';
import { setRevealedTableEffect, getRevealedTable } from './searchRevealState';

/**
 * Updates the revealed table state based on cursor position.
 * Only reveals if cursor is inside a table; clears reveal if cursor is outside.
 */
function updateRevealedTable(view: EditorView): void {
    const cursorPos = view.state.selection.main.head;
    const table = resolveTableAtPos(view.state, cursorPos);
    const currentRevealed = getRevealedTable(view.state);
    const newRevealed = table?.from ?? null;

    if (newRevealed !== currentRevealed) {
        view.dispatch({ effects: setRevealedTableEffect.of(newRevealed) });
    }
}

/**
 * Clears the revealed table state.
 */
function clearRevealedTable(view: EditorView): void {
    if (getRevealedTable(view.state) !== null) {
        view.dispatch({ effects: setRevealedTableEffect.of(null) });
    }
}

interface SearchWatcherState {
    isSearchOpen: boolean;
    lastCursorPos: number;
}

/**
 * Creates the search panel watcher extension.
 * Requires the main EditorView reference to dispatch effects and open editors.
 */
export function createSearchPanelWatcher(mainView: EditorView): Extension {
    return StateField.define<SearchWatcherState>({
        create: (state) => ({
            isSearchOpen: searchPanelOpen(state),
            lastCursorPos: state.selection.main.head,
        }),
        update(prev, tr) {
            const isOpen = searchPanelOpen(tr.state);
            const cursorPos = tr.state.selection.main.head;

            // Search panel just opened → close nested editor and reveal table at cursor
            if (!prev.isSearchOpen && isOpen) {
                queueMicrotask(() => {
                    if (isNestedCellEditorOpen(mainView)) {
                        closeNestedCellEditor(mainView);
                    }
                    if (getActiveCell(mainView.state)) {
                        mainView.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                    }
                    // Reveal the table at cursor position (if any)
                    updateRevealedTable(mainView);
                });
            }

            // Search panel is open and cursor moved → update revealed table
            if (prev.isSearchOpen && isOpen && cursorPos !== prev.lastCursorPos) {
                queueMicrotask(() => {
                    updateRevealedTable(mainView);
                });
            }

            // Search panel just closed → clear reveal and activate cell
            if (prev.isSearchOpen && !isOpen) {
                queueMicrotask(() => {
                    clearRevealedTable(mainView);
                    activateCellAtPosition(mainView, mainView.state.selection.main.head);
                });
            }

            return { isSearchOpen: isOpen, lastCursorPos: cursorPos };
        },
    });
}

/**
 * Watches for Joplin's search panel open/close transitions.
 * - On open: closes nested editor and reveals table at cursor (raw markdown)
 * - While open: updates revealed table as cursor moves between tables
 * - On close: clears reveal state and activates cell if cursor is in table
 *
 * This enables CodeMirror's native search highlighting to work on table content
 * while the search panel is open.
 */
import { ViewPlugin, ViewUpdate, EditorView } from '@codemirror/view';
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

/**
 * ViewPlugin that watches for search panel state transitions.
 * Uses ViewPlugin instead of StateField because it needs to perform side effects
 * (dispatching effects, closing nested editors) which belong in ViewPlugin.update().
 */
export const searchPanelWatcherPlugin = ViewPlugin.fromClass(
    class {
        private wasSearchOpen: boolean;
        private lastCursorPos: number;

        constructor(private view: EditorView) {
            this.wasSearchOpen = searchPanelOpen(view.state);
            this.lastCursorPos = view.state.selection.main.head;
        }

        update(update: ViewUpdate): void {
            const isOpen = searchPanelOpen(update.state);
            const cursorPos = update.state.selection.main.head;

            // Search panel just opened → close nested editor and reveal table at cursor
            // Use queueMicrotask to defer dispatches until after the current update cycle.
            if (!this.wasSearchOpen && isOpen) {
                queueMicrotask(() => {
                    if (isNestedCellEditorOpen(this.view)) {
                        closeNestedCellEditor(this.view);
                    }
                    if (getActiveCell(this.view.state)) {
                        this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                    }
                    // Reveal the table at cursor position (if any)
                    updateRevealedTable(this.view);
                });
            }

            // Search panel is open and cursor moved → update revealed table
            if (this.wasSearchOpen && isOpen && cursorPos !== this.lastCursorPos) {
                queueMicrotask(() => {
                    updateRevealedTable(this.view);
                });
            }

            // Search panel just closed → clear reveal and activate cell
            if (this.wasSearchOpen && !isOpen) {
                queueMicrotask(() => {
                    clearRevealedTable(this.view);
                    activateCellAtPosition(this.view, this.view.state.selection.main.head);
                });
            }

            this.wasSearchOpen = isOpen;
            this.lastCursorPos = cursorPos;
        }
    }
);

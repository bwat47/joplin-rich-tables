/**
 * Watches for Joplin's search panel open/close transitions.
 * - On open: closes nested editor and forces raw markdown tables globally
 * - On close: restores widgets and triggers re-activation at the cursor
 *
 * This enables CodeMirror's native search highlighting to work on table content
 * while the search panel is open.
 */
import { ViewPlugin, ViewUpdate, EditorView } from '@codemirror/view';
import { searchPanelOpen } from '@codemirror/search';
import { clearActiveCellEffect, getActiveCell } from './activeCellState';
import { closeNestedCellEditor, isNestedCellEditorOpen } from '../nestedEditor/nestedCellEditor';
import { setSearchForceSourceModeEffect, exitSearchForceSourceModeEffect } from './searchForceSourceMode';

/**
 * ViewPlugin that watches for search panel state transitions.
 * Uses ViewPlugin instead of StateField because it needs to perform side effects
 * (dispatching effects, closing nested editors) which belong in ViewPlugin.update().
 */
export const searchPanelWatcherPlugin = ViewPlugin.fromClass(
    class {
        private wasSearchOpen: boolean;

        constructor(private view: EditorView) {
            this.wasSearchOpen = searchPanelOpen(view.state);
        }

        update(update: ViewUpdate): void {
            const isOpen = searchPanelOpen(update.state);

            // Search panel just opened → close nested editor and force raw markdown tables
            // Use queueMicrotask to defer dispatches until after the current update cycle.
            if (!this.wasSearchOpen && isOpen) {
                queueMicrotask(() => {
                    if (isNestedCellEditorOpen(this.view)) {
                        closeNestedCellEditor(this.view);
                    }
                    if (getActiveCell(this.view.state)) {
                        this.view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                    }

                    this.view.dispatch({ effects: setSearchForceSourceModeEffect.of(true) });
                });
            }

            // Search panel just closed → restore widgets (unless user source mode is enabled)
            if (this.wasSearchOpen && !isOpen) {
                queueMicrotask(() => {
                    this.view.dispatch({
                        effects: [
                            setSearchForceSourceModeEffect.of(false),
                            exitSearchForceSourceModeEffect.of(undefined),
                        ],
                    });
                });
            }

            this.wasSearchOpen = isOpen;
        }
    }
);

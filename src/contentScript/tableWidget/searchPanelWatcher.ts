/**
 * Watches for Joplin's search panel open/close transitions.
 * - On close: auto-activates cell editor if cursor is inside a table
 * - On open: closes nested editor to allow searching raw markdown
 *
 * Note: Since tables are always rendered as widgets, no rebuild is triggered.
 * The widget stays visible during search; future enhancement could add
 * in-widget search highlighting.
 */
import { StateField, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { searchPanelOpen } from '@codemirror/search';
import { clearActiveCellEffect, getActiveCell } from './activeCellState';
import { closeNestedCellEditor, isNestedCellEditorOpen } from '../nestedEditor/nestedCellEditor';
import { activateCellAtPosition } from './cellActivation';

/**
 * Creates the search panel watcher extension.
 * Requires the main EditorView reference to dispatch effects and open editors.
 */
export function createSearchPanelWatcher(mainView: EditorView): Extension {
    return StateField.define<boolean>({
        create: (state) => searchPanelOpen(state),
        update(wasOpen, tr) {
            const isOpen = searchPanelOpen(tr.state);

            // Search panel just opened → close nested editor so user can search.
            if (!wasOpen && isOpen) {
                queueMicrotask(() => {
                    if (isNestedCellEditorOpen(mainView)) {
                        closeNestedCellEditor(mainView);
                    }
                    if (getActiveCell(mainView.state)) {
                        mainView.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                    }
                });
            }

            // Search panel just closed → activate cell if cursor is in table
            if (wasOpen && !isOpen) {
                queueMicrotask(() => {
                    const cursorPos = mainView.state.selection.main.head;
                    activateCellAtPosition(mainView, cursorPos);
                });
            }

            return isOpen;
        },
    });
}

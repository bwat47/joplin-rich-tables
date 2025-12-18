import { EditorView, keymap } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { StateField } from '@codemirror/state';
import { navigateCell } from '../tableWidget/tableNavigation';
import { SubviewCellRange } from './transactionPolicy';

/**
 * Creates a helper function that preserves scroll positions while executing
 * a callback (like undo/redo).
 * - Preserves main editor's vertical scroll (scrollTop)
 * - Preserves table widget's horizontal scroll (scrollLeft)
 */
function createPreserveScroll(mainView: EditorView) {
    return (fn: () => void) => {
        // Capture main editor's vertical scroll
        const scrollDOM = mainView.scrollDOM;
        const scrollTop = scrollDOM.scrollTop;

        // Capture the table widget's horizontal scroll if one is currently active
        const tableWidget = mainView.dom.querySelector('.cm-table-widget') as HTMLElement | null;
        const tableScrollLeft = tableWidget?.scrollLeft ?? null;
        const tableSelector = tableWidget?.dataset.tableFrom
            ? `.cm-table-widget[data-table-from="${tableWidget.dataset.tableFrom}"]`
            : null;

        // Execute the action (undo/redo)
        fn();

        // Define the restoration logic
        const restoreScroll = () => {
            // Restore main editor's vertical scroll
            if (scrollDOM.scrollTop !== scrollTop) {
                scrollDOM.scrollTop = scrollTop;
            }

            // Restore table widget's horizontal scroll if we had one
            if (tableScrollLeft !== null && tableSelector) {
                const currentTableWidget = mainView.dom.querySelector(tableSelector) as HTMLElement | null;
                if (currentTableWidget && currentTableWidget.scrollLeft !== tableScrollLeft) {
                    currentTableWidget.scrollLeft = tableScrollLeft;
                }
            }
        };

        // Restore immediately
        restoreScroll();

        // Restore again in the next animation frame
        requestAnimationFrame(restoreScroll);

        // Restore one more time after a delay to catch widget rebuilds
        // Table widgets may be rebuilt asynchronously after undo/redo
        setTimeout(restoreScroll, 50);
    };
}

/** Creates a keymap for the nested editor to handle undo/redo and table navigation (arrows, tab, enter). */
export function createNestedEditorKeymap(mainView: EditorView, rangeField: StateField<SubviewCellRange>) {
    const preserveMainScroll = createPreserveScroll(mainView);

    return keymap.of([
        {
            key: 'Mod-z',
            run: () => {
                preserveMainScroll(() => undo(mainView));
                return true;
            },
        },
        {
            key: 'Mod-y',
            run: () => {
                preserveMainScroll(() => redo(mainView));
                return true;
            },
        },
        {
            key: 'Mod-Shift-z',
            run: () => {
                preserveMainScroll(() => redo(mainView));
                return true;
            },
        },

        {
            key: 'Tab',
            run: () => {
                return navigateCell(mainView, 'next');
            },
        },
        {
            key: 'Shift-Tab',
            run: () => {
                return navigateCell(mainView, 'previous');
            },
        },
        {
            key: 'Enter',
            run: () => {
                return navigateCell(mainView, 'down');
            },
        },
        {
            key: 'ArrowLeft',
            run: (nestedView) => {
                const { from } = nestedView.state.field(rangeField);
                const { head } = nestedView.state.selection.main;
                if (head === from) {
                    return navigateCell(mainView, 'previous', { cursorPos: 'end' });
                }
                return false;
            },
        },
        {
            key: 'ArrowRight',
            run: (nestedView) => {
                const { to } = nestedView.state.field(rangeField);
                const { head } = nestedView.state.selection.main;
                if (head === to) {
                    return navigateCell(mainView, 'next', { cursorPos: 'start' });
                }
                return false;
            },
        },
        {
            key: 'ArrowUp',
            run: (nestedView) => {
                const { from } = nestedView.state.field(rangeField);
                const { head } = nestedView.state.selection.main;

                // Use coordinate check to determine if we are on the first visual line.
                // We compare the top coordinate of the cursor with the top coordinate of the start of the cell.
                const headRect = nestedView.coordsAtPos(head);
                const fromRect = nestedView.coordsAtPos(from);

                if (headRect && fromRect) {
                    // Allow small sub-pixel differences
                    const isSameLine = Math.abs(headRect.top - fromRect.top) < 2;
                    if (isSameLine) {
                        return navigateCell(mainView, 'up', { cursorPos: 'start' });
                    }
                } else if (head === from) {
                    // Fallback if coords unavailable (e.g. invalid layout), relying on position.
                    return navigateCell(mainView, 'up', { cursorPos: 'start' });
                }

                return false;
            },
        },
        {
            key: 'ArrowDown',
            run: (nestedView) => {
                const { to } = nestedView.state.field(rangeField);
                const { head } = nestedView.state.selection.main;

                // Use coordinate check to determine if we are on the last visual line.
                const headRect = nestedView.coordsAtPos(head);
                const toRect = nestedView.coordsAtPos(to);

                if (headRect && toRect) {
                    // Compare bottoms? Or tops?
                    // If we are on the last line, our top should be the same as the last character's top.
                    const isSameLine = Math.abs(headRect.top - toRect.top) < 2;

                    if (isSameLine) {
                        return navigateCell(mainView, 'down', { cursorPos: 'start' });
                    }
                } else if (head === to) {
                    return navigateCell(mainView, 'down', { cursorPos: 'start' });
                }

                return false;
            },
        },
    ]);
}

/** Creates DOM event handlers for the nested editor (keydown, contextmenu). */
export function createNestedEditorDomHandlers() {
    return EditorView.domEventHandlers({
        // Android virtual keyboards commonly emit `beforeinput`/composition events
        // rather than `keydown`. These events bubble, and since the nested editor
        // is mounted inside the main editor DOM, they can accidentally trigger
        // main-editor handlers (e.g. Backspace deleting table pipes).
        //
        // We only stop propagation (do NOT preventDefault) so CodeMirror can still
        // handle the input normally inside the nested editor.
        beforeinput: (e) => {
            e.stopPropagation();
            return false;
        },
        // Some Android IMEs still emit `input` events that bubble even when `beforeinput`
        // is stopped. If these reach the main editor, CodeMirror may try to respond
        // (selection/scroll updates) even though the nested editor is the real target.
        input: (e) => {
            e.stopPropagation();
            return false;
        },
        compositionstart: (e) => {
            e.stopPropagation();
            return false;
        },
        compositionupdate: (e) => {
            e.stopPropagation();
            return false;
        },
        compositionend: (e) => {
            e.stopPropagation();
            return false;
        },
        keydown: (e) => {
            const isMod = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();

            // Allow common application shortcuts (that aren't problematic) to bubble to the main window
            if (isMod && ['s', 'p'].includes(key)) {
                return false;
            }

            // Never let other key events bubble to the main editor. The main editor may still
            // have a selection outside the table, and handling Backspace/Delete there
            // would appear as "deleting outside the cell".
            e.stopPropagation();

            if (isMod) {
                // Allow Ctrl+A/C/V/X which work correctly via browser/CodeMirror.
                // Allow Ctrl+Z/Y to pass through to the keymap.
                const allowedKeys = ['a', 'c', 'v', 'x', 'z', 'y'];
                if (!allowedKeys.includes(key)) {
                    e.preventDefault();
                    return true;
                }
            }
            return false;
        },
        contextmenu: (e) => {
            // Prevent all context menus - Joplin's menu doesn't work
            // in the nested editor, so suppress it entirely.
            e.stopPropagation();
            e.preventDefault();
            return true;
        },
    });
}

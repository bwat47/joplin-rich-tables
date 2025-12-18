import { EditorView, keymap } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { StateField, Transaction } from '@codemirror/state';
import { navigateCell } from '../tableWidget/tableNavigation';
import { getActiveCell } from '../tableWidget/activeCellState';
import { SubviewCellRange } from './transactionPolicy';

function runHistoryCommandWithMainScrollPreserved(
    mainView: EditorView,
    command: (target: { state: EditorView['state']; dispatch: (tr: Transaction) => void }) => boolean
): boolean {
    const scrollSnapshotEffect = mainView.scrollSnapshot();

    // Wide tables have their own horizontal scroller on the widget container.
    // Undo/redo can rebuild widgets or trigger internal scroll adjustments, which
    // otherwise snaps this back to the left.
    const activeCell = getActiveCell(mainView.state);
    const tableFrom = activeCell?.tableFrom;
    const widgetContainer =
        tableFrom !== undefined
            ? (mainView.dom.querySelector(`.cm-table-widget[data-table-from="${tableFrom}"]`) as HTMLElement | null)
            : null;
    const widgetScrollLeft = widgetContainer ? widgetContainer.scrollLeft : 0;

    const restoreWidgetScroll = () => {
        if (tableFrom === undefined) {
            return;
        }

        const currentWidget = mainView.dom.querySelector(
            `.cm-table-widget[data-table-from="${tableFrom}"]`
        ) as HTMLElement | null;
        if (currentWidget && currentWidget.scrollLeft !== widgetScrollLeft) {
            currentWidget.scrollLeft = widgetScrollLeft;
        }
    };

    const dispatch = (tr: Transaction) => {
        mainView.dispatch(tr);

        // Map the snapshot effect through the document changes made by undo/redo.
        // This keeps the scroll restoration accurate even if the doc changed.
        const mappedScrollSnapshot = scrollSnapshotEffect.map(tr.changes);

        const restore = () => {
            // Restore the editor's own scroll position.
            mainView.dispatch({
                effects: mappedScrollSnapshot,
                annotations: Transaction.addToHistory.of(false),
            });

            // Restore the table widget's internal horizontal scroll.
            restoreWidgetScroll();
        };

        // Restore immediately, then again after layout stabilizes.
        restore();
        requestAnimationFrame(restore);
    };

    return command({ state: mainView.state, dispatch });
}

/** Creates a keymap for the nested editor to handle undo/redo and table navigation (arrows, tab, enter). */
export function createNestedEditorKeymap(mainView: EditorView, rangeField: StateField<SubviewCellRange>) {
    return keymap.of([
        {
            key: 'Mod-z',
            run: () => {
                return runHistoryCommandWithMainScrollPreserved(mainView, undo);
            },
        },
        {
            key: 'Mod-y',
            run: () => {
                return runHistoryCommandWithMainScrollPreserved(mainView, redo);
            },
        },
        {
            key: 'Mod-Shift-z',
            run: () => {
                return runHistoryCommandWithMainScrollPreserved(mainView, redo);
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

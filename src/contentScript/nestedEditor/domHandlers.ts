import { EditorView, keymap } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { StateField, Transaction, StateCommand, EditorSelection } from '@codemirror/state';
import { navigateCell } from '../tableWidget/tableNavigation';
import { getActiveCell } from '../tableWidget/activeCellState';
import { getWidgetSelector } from '../tableWidget/domConstants';
import { SubviewCellRange, syncAnnotation } from './transactionPolicy';

function syncNestedSelectionToMain(params: {
    nestedView: EditorView;
    mainView: EditorView;
    rangeField: StateField<SubviewCellRange>;
    event?: MouseEvent;
}): void {
    const { nestedView, mainView, rangeField, event } = params;

    // Ensure the nested editor is focused so the browser/electron selection APIs
    // see the correct active editable element.
    nestedView.focus();

    // If this is a right-click with an empty selection, move the caret to the click.
    // This matches the user expectation for context-sensitive actions.
    const nestedSel = nestedView.state.selection.main;
    const isEmpty = nestedSel.empty;
    if (event && isEmpty) {
        const clickedPos = nestedView.posAtCoords({ x: event.clientX, y: event.clientY });
        if (clickedPos != null) {
            const { from, to } = nestedView.state.field(rangeField);
            const clamped = Math.max(from, Math.min(to, clickedPos));
            if (clamped !== nestedSel.head) {
                nestedView.dispatch({
                    selection: EditorSelection.single(clamped, clamped),
                    annotations: Transaction.addToHistory.of(false),
                    scrollIntoView: false,
                });
            }
        }
    }

    // Mirror the nested selection into the main editor so Joplin/plugin context menus
    // that read from the main editor state use the correct cursor/selection.
    const selToMirror = nestedView.state.selection.main;
    mainView.dispatch({
        selection: EditorSelection.single(selToMirror.anchor, selToMirror.head),
        annotations: [syncAnnotation.of(true), Transaction.addToHistory.of(false)],
        scrollIntoView: false,
    });
}

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
            ? (mainView.dom.querySelector(getWidgetSelector(tableFrom)) as HTMLElement | null)
            : null;
    const widgetScrollLeft = widgetContainer ? widgetContainer.scrollLeft : 0;

    const restoreWidgetScroll = () => {
        if (tableFrom === undefined) {
            return;
        }

        const currentWidget = mainView.dom.querySelector(getWidgetSelector(tableFrom)) as HTMLElement | null;
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
export function createNestedEditorKeymap(
    mainView: EditorView,
    rangeField: StateField<SubviewCellRange>,
    extraBindings?: Record<string, StateCommand>
) {
    const bindings = [
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
    ];

    if (extraBindings) {
        for (const [key, command] of Object.entries(extraBindings)) {
            bindings.push({ key, run: command });
        }
    }

    return keymap.of(bindings);
}

/** Creates DOM event handlers for the nested editor (keydown, contextmenu). */
export function createNestedEditorDomHandlers(mainView: EditorView, rangeField: StateField<SubviewCellRange>) {
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

            // Block shortcuts that conflict with the nested editor.
            // We intentionally block find-in-page to avoid stealing focus or showing
            // a find UI that doesn't work well inside the nested editor.
            if (isMod && key === 'f') {
                e.preventDefault();
                e.stopPropagation();
                return true;
            }

            // Let Joplin's native markdown formatting shortcuts handle these.
            // We mirror the nested selection into the main editor, so applying
            // formatting at the "main" layer targets the correct range.
            if (isMod && ['b', 'i', 'u', '`', 'e', 'k'].includes(key)) {
                return false;
            }

            // Allow common application shortcuts (that aren't problematic) to bubble to the main window
            if (isMod && ['s', 'p'].includes(key)) {
                return false;
            }

            // Never let other key events bubble to the main editor. The main editor may still
            // have a selection outside the table, and handling Backspace/Delete there
            // would appear as "deleting outside the cell".
            e.stopPropagation();
            return false;
        },
        mousedown: (e, view) => {
            // On desktop, right-click often does not move focus/caret by default.
            // Sync focus + selection so Joplin's context menu and other plugins
            // see the correct cursor/selection.
            const mouseEvent = e as MouseEvent;
            if (mouseEvent.button === 2) {
                syncNestedSelectionToMain({
                    nestedView: view,
                    mainView,
                    rangeField,
                    event: mouseEvent,
                });
            }
            return false;
        },
        contextmenu: (e, view) => {
            // On desktop, this is a true right-click and we want Joplin/plugins to see
            // the correct cursor/selection.
            //
            // On Android, a long-press can emit a `contextmenu` event during the
            // selection gesture; syncing here can collapse the selection and make
            // text effectively unselectable.
            const mouseEvent = e as MouseEvent;
            if (mouseEvent.button === 2) {
                syncNestedSelectionToMain({
                    nestedView: view,
                    mainView,
                    rangeField,
                    event: mouseEvent,
                });
            }
            // Allow the context menu to show.
            return false;
        },
    });
}

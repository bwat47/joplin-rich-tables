import { selectAll } from '@codemirror/commands';
import { EditorSelection, Transaction, type Extension } from '@codemirror/state';
import { EditorView, keymap, runScopeHandlers, type KeyBinding } from '@codemirror/view';
import { findNext, openSearchPanel, searchKeymap } from '@codemirror/search';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { startCellSelectionFromActiveCell } from '../tableRuntime/selection/cellSelectionController';
import { navigateCell } from '../tableRuntime/navigation/tableNavigation';
import { handleTableClipboardTextPaste } from '../tableRuntime/selection/cellSelectionClipboard';
import { createHistoryKeyBindings } from '../tableRuntime/historyKeymap';
import { routeKeyEventToRootEditor } from './nestedEditorEventRouting';

/** Dedicated keymap scope so root-routing bindings never match nested-editor navigation. */
const ROOT_ROUTING_SCOPE = 'table.nestedEditor.rootRouting';

/**
 * Mod-shortcuts routed to the root editor's keymap (bold, italic, underline, code, link), for
 * hosts whose formatting shortcuts exist only as editor key bindings, mainly Joplin mobile.
 * Desktop menu shortcuts, including rebound and plugin ones, fire without this list because
 * unrouted chords still bubble un-prevented to the host.
 */
const ROOT_COMMAND_KEYS: readonly string[] = ['b', 'i', 'u', '`', 'e', 'k'];

/**
 * Routing commands never handle the chord themselves. Returning true only claims it for the
 * root editor; the keydown handler below then routes the event there as it bubbles.
 */
const ROUTE_TO_ROOT = true;

/**
 * Search chords the root editor runs: open search (Mod-f) and find next/previous (F3, Mod-g),
 * each of which carries find-previous as its shift variant.
 */
function isRootSearchBinding(binding: KeyBinding): boolean {
    return binding.run === openSearchPanel || binding.run === findNext;
}

/**
 * Adapts CodeMirror's search chords, inheriting only their platform key fields so each chord
 * matches the root editor's. The root selection is synchronized first, so the panel seeds its
 * query from the nested selection and find next/previous starts at the nested caret; a match
 * in another cell then opens that cell (see `searchMatchCellEntry`).
 *
 * Opening the search panel clears the active cell, which closes this editor. It must stay
 * mounted until then: the root editor ignores a keydown whose target is no longer inside its
 * content.
 */
function createSearchRoutingBindings(ensureRootSelectionForCommand: () => void): KeyBinding[] {
    const route = (): boolean => {
        ensureRootSelectionForCommand();
        return ROUTE_TO_ROOT;
    };

    return searchKeymap.filter(isRootSearchBinding).map((binding) => ({
        key: binding.key,
        mac: binding.mac,
        win: binding.win,
        linux: binding.linux,
        run: route,
        shift: binding.shift ? route : undefined,
        scope: ROOT_ROUTING_SCOPE,
    }));
}

function createRootRoutingBindings(options: { ensureRootSelectionForCommand: () => void }): KeyBinding[] {
    return [
        ...createSearchRoutingBindings(options.ensureRootSelectionForCommand),
        ...ROOT_COMMAND_KEYS.map((key) => ({
            key: `Mod-${key}`,
            run: () => {
                options.ensureRootSelectionForCommand();
                return ROUTE_TO_ROOT;
            },
            scope: ROOT_ROUTING_SCOPE,
        })),
    ];
}

/** Vertical tolerance (px) for treating two caret rects as the same visual line. */
const SAME_VISUAL_LINE_TOLERANCE_PX = 2;

/**
 * True when the nested caret sits on the same visual (wrapped) line as `pos`.
 *
 * `coordsAtPos` returns null when the view is not laid out (notably under jsdom),
 * so the exact-position check is both the fast path and the measurement fallback.
 */
function isCaretOnSameVisualLine(view: EditorView, pos: number): boolean {
    const { head } = view.state.selection.main;
    if (head === pos) {
        return true;
    }

    const headRect = view.coordsAtPos(head);
    const posRect = view.coordsAtPos(pos);
    if (!headRect || !posRect) {
        return false;
    }

    return Math.abs(headRect.top - posRect.top) < SAME_VISUAL_LINE_TOLERANCE_PX;
}

export function createNestedEditorKeymap(
    mainView: EditorView,
    options: {
        closeEditor: () => void;
        syncPendingChangesToRoot: () => void;
    }
): Extension {
    const bindings: KeyBinding[] = [
        ...createHistoryKeyBindings((_view, command) => command(mainView)),
        {
            key: 'Mod-a',
            run: selectAll,
        },
        {
            key: 'Tab',
            run: () => {
                options.syncPendingChangesToRoot();
                return navigateCell(mainView, 'next', { allowRowCreation: true });
            },
        },
        {
            key: 'Shift-Tab',
            run: () => {
                options.syncPendingChangesToRoot();
                return navigateCell(mainView, 'previous');
            },
        },
        {
            key: 'Enter',
            run: () => {
                options.syncPendingChangesToRoot();
                return navigateCell(mainView, 'down', { allowRowCreation: true });
            },
        },
        {
            key: 'ArrowLeft',
            run: (nestedView) => {
                if (nestedView.state.selection.main.head === 0) {
                    options.syncPendingChangesToRoot();
                    return navigateCell(mainView, 'previous', {
                        initialCursorPos: 'end',
                        exitTableAtBoundary: true,
                    });
                }
                return false;
            },
        },
        {
            key: 'ArrowRight',
            run: (nestedView) => {
                if (nestedView.state.selection.main.head === nestedView.state.doc.length) {
                    options.syncPendingChangesToRoot();
                    return navigateCell(mainView, 'next', {
                        initialCursorPos: 'start',
                        exitTableAtBoundary: true,
                    });
                }
                return false;
            },
        },
        {
            key: 'ArrowUp',
            run: (nestedView) => {
                if (!isCaretOnSameVisualLine(nestedView, 0)) {
                    return false;
                }

                options.syncPendingChangesToRoot();
                return navigateCell(mainView, 'up', {
                    initialCursorPos: 'lastLineStart',
                    exitTableAtBoundary: true,
                });
            },
        },
        {
            key: 'ArrowDown',
            run: (nestedView) => {
                if (!isCaretOnSameVisualLine(nestedView, nestedView.state.doc.length)) {
                    return false;
                }

                options.syncPendingChangesToRoot();
                return navigateCell(mainView, 'down', {
                    initialCursorPos: 'start',
                    exitTableAtBoundary: true,
                });
            },
        },
        {
            key: 'Shift-ArrowLeft',
            run: (nestedView) => {
                if (nestedView.state.selection.main.head !== 0) {
                    return false;
                }

                options.closeEditor();
                return startCellSelectionFromActiveCell(mainView, 'left');
            },
        },
        {
            key: 'Shift-ArrowRight',
            run: (nestedView) => {
                if (nestedView.state.selection.main.head !== nestedView.state.doc.length) {
                    return false;
                }

                options.closeEditor();
                return startCellSelectionFromActiveCell(mainView, 'right');
            },
        },
        {
            key: 'Shift-ArrowUp',
            run: (nestedView) => {
                if (!isCaretOnSameVisualLine(nestedView, 0)) {
                    return false;
                }

                options.closeEditor();
                return startCellSelectionFromActiveCell(mainView, 'up');
            },
        },
        {
            key: 'Shift-ArrowDown',
            run: (nestedView) => {
                if (!isCaretOnSameVisualLine(nestedView, nestedView.state.doc.length)) {
                    return false;
                }

                options.closeEditor();
                return startCellSelectionFromActiveCell(mainView, 'down');
            },
        },
    ];

    return keymap.of(bindings);
}

export function createNestedEditorDomHandlers(
    mainView: EditorView,
    options: {
        syncSelectionToMain: (view: EditorView, event: MouseEvent) => void;
        ensureRootSelectionForCommand: () => void;
    }
): Extension[] {
    return [
        keymap.of(createRootRoutingBindings(options)),
        EditorView.domEventHandlers({
            // Last stop for a paste that reaches the nested editor directly: the document-level
            // clipboard capture runs first and marks the event handled, so this only fires when
            // that capture declined it. A markdown-table fragment still belongs to the multi-cell
            // rewrite; anything else falls through to CodeMirror's own paste handling.
            paste: (e) => {
                const clipboardText = e.clipboardData?.getData('text/plain');
                if (!clipboardText) {
                    return false;
                }

                return handleTableClipboardTextPaste(clipboardText, mainView, {
                    nestedEditorOpen: true,
                });
            },
            // Never marks the event as handled; local CodeMirror keymaps still run on
            // this element. Keydowns, like input and composition events, bubble so the
            // host sees them, while `TableWidget.ignoreEvent` hides them from the root
            // editor unless a routing binding claimed the keydown for root.
            keydown: (e, view) => {
                if (runScopeHandlers(view, e, ROOT_ROUTING_SCOPE)) {
                    routeKeyEventToRootEditor(e);
                }

                return false;
            },
            mousedown: (e, view) => {
                const mouseEvent = e as MouseEvent;
                // Mirror the right-click position to the main editor so context-menu plugins that
                // read the main cursor (e.g. link actions) target the clicked location. This only
                // moves the main editor's selection, never the nested editor's, so Chromium's
                // native selection of a misspelled word survives and spelling suggestions appear.
                if (mouseEvent.button === 2) {
                    options.syncSelectionToMain(view, mouseEvent);
                }
                // The nested editor is mounted inside the main editor DOM. If this bubbles,
                // the outer CodeMirror instance can treat clicks on selection layers as
                // outside-widget interactions and move the root cursor out of the table.
                //
                // Deliberately no matching `pointerdown` handler: mouseCellDragSelection
                // observes that event here to turn a text drag into a cell-selection drag,
                // so stopping its propagation would silently disable the feature.
                e.stopPropagation();
                return false;
            },
            click: (e) => {
                e.stopPropagation();
                return false;
            },
            contextmenu: (e, view) => {
                const mouseEvent = e as MouseEvent;
                if (mouseEvent.button === 2) {
                    options.syncSelectionToMain(view, mouseEvent);
                }
                e.stopPropagation();
                return false;
            },
        }),
    ];
}

export function mirrorLocalSelectionToMain(params: {
    nestedView: EditorView;
    mainView: EditorView;
    selection: { anchor: number; head: number };
}): void {
    params.nestedView.focus();
    params.mainView.dispatch({
        selection: EditorSelection.single(params.selection.anchor, params.selection.head),
        annotations: [syncAnnotation.of(true), Transaction.addToHistory.of(false)],
        scrollIntoView: false,
    });
}

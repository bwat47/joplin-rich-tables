import { EditorSelection, StateCommand, Transaction, type Extension } from '@codemirror/state';
import { EditorView, keymap, runScopeHandlers, type Command, type KeyBinding } from '@codemirror/view';
import { openSearchPanel, searchKeymap } from '@codemirror/search';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { clearActiveCellEffect, getActiveCell } from '../tableState/activeCellState';
import { startCellSelectionFromActiveCell } from '../tableRuntime/selection/cellSelectionController';
import { navigateCell } from '../tableRuntime/navigation/tableNavigation';
import { handleTableClipboardTextPaste } from '../tableRuntime/selection/cellSelectionClipboard';
import { createHistoryKeyBindings } from '../tableRuntime/historyKeymap';

/** Dedicated keymap scope so host-routing bindings never match nested-editor navigation. */
const NESTED_EDITOR_ROUTING_SCOPE = 'table.nestedEditor.routing';

/**
 * Mod-shortcuts that run as root editor commands (bold, italic, underline, code, link).
 * They need a root selection mirroring the nested editor before they bubble out.
 */
const ROOT_COMMAND_KEYS: readonly string[] = ['b', 'i', 'u', '`', 'e', 'k'];

/**
 * Mod-shortcuts handled entirely by Joplin/the host (save, print, paste).
 * They bubble untouched with no extra nested-editor bookkeeping.
 */
const HOST_PASSTHROUGH_KEYS: readonly string[] = ['s', 'p', 'v'];

/**
 * Routing commands invert CodeMirror's usual `Command` contract. The keydown handler below
 * stops propagation for every chord this scope does not claim, so a command returning true
 * means "this chord belongs to the host, let it bubble" rather than "handled, stop here".
 */
const BUBBLE_TO_HOST = true;

/** Claims a chord for the host without any nested-editor bookkeeping. */
const bubbleToHost: Command = () => BUBBLE_TO_HOST;

function isOpenSearchBinding(binding: KeyBinding): boolean {
    return binding.run === openSearchPanel;
}

/**
 * Adapts CodeMirror's `openSearchPanel` chord, inheriting only its platform key
 * fields. Search replaces the nested editor, so the command closes it and clears
 * active-cell state before the event bubbles.
 */
function createSearchRoutingBinding(mainView: EditorView, closeEditor: () => void): KeyBinding[] {
    return searchKeymap.filter(isOpenSearchBinding).map((binding) => ({
        key: binding.key,
        mac: binding.mac,
        win: binding.win,
        linux: binding.linux,
        run: () => {
            closeEditor();
            if (getActiveCell(mainView.state)) {
                mainView.dispatch({ effects: clearActiveCellEffect.of(undefined) });
            }
            return BUBBLE_TO_HOST;
        },
        scope: NESTED_EDITOR_ROUTING_SCOPE,
    }));
}

function createNestedEditorRoutingBindings(
    mainView: EditorView,
    options: {
        closeEditor: () => void;
        ensureRootSelectionForCommand: () => void;
    }
): KeyBinding[] {
    return [
        ...createSearchRoutingBinding(mainView, options.closeEditor),
        ...ROOT_COMMAND_KEYS.map((key) => ({
            key: `Mod-${key}`,
            run: () => {
                options.ensureRootSelectionForCommand();
                return BUBBLE_TO_HOST;
            },
            scope: NESTED_EDITOR_ROUTING_SCOPE,
        })),
        ...HOST_PASSTHROUGH_KEYS.map((key) => ({
            key: `Mod-${key}`,
            run: bubbleToHost,
            scope: NESTED_EDITOR_ROUTING_SCOPE,
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
        extraBindings?: Record<string, StateCommand>;
    }
): Extension {
    const bindings: KeyBinding[] = [
        ...createHistoryKeyBindings((_view, command) => command(mainView)),
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

    if (options.extraBindings) {
        for (const [key, command] of Object.entries(options.extraBindings)) {
            bindings.push({ key, run: command });
        }
    }

    return keymap.of(bindings);
}

export function createNestedEditorDomHandlers(
    mainView: EditorView,
    options: {
        syncSelectionToMain: (view: EditorView, event?: MouseEvent) => void;
        closeEditor: () => void;
        ensureRootSelectionForCommand: () => void;
    }
): Extension[] {
    return [
        keymap.of(createNestedEditorRoutingBindings(mainView, options)),
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
            beforeinput: (e) => {
                e.stopPropagation();
                return false;
            },
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
            // Never marks the event as handled; local CodeMirror keymaps still run on
            // this element. A routing hit means the chord belongs to the host (see
            // `BUBBLE_TO_HOST`); unmatched chords stay inside the nested editor.
            keydown: (e, view) => {
                if (!runScopeHandlers(view, e, NESTED_EDITOR_ROUTING_SCOPE)) {
                    e.stopPropagation();
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

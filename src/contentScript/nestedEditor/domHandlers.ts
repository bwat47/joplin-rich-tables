import { EditorSelection, StateCommand, Transaction, type Extension } from '@codemirror/state';
import { undo, redo } from '@codemirror/commands';
import { EditorView, keymap, type KeyBinding } from '@codemirror/view';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { clearActiveCellEffect, getActiveCell } from '../tableState/activeCellState';
import { startCellSelectionFromActiveCell } from '../tableRuntime/selection/cellSelectionController';
import { navigateCell } from '../tableRuntime/navigation/tableNavigation';
import { handleTableClipboardTextPaste } from '../tableRuntime/selection/cellSelectionClipboard';

function runHistoryCommand(mainView: EditorView, command: StateCommand): boolean {
    return command(mainView);
}

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

export function createNestedEditorKeymap(
    mainView: EditorView,
    options: {
        getSelectionBounds: (view: EditorView) => { from: number; to: number };
        closeEditor: () => void;
        syncPendingChangesToRoot: () => void;
        extraBindings?: Record<string, StateCommand>;
    }
): Extension {
    const bindings: KeyBinding[] = [
        { key: 'Mod-z', run: () => runHistoryCommand(mainView, undo) },
        { key: 'Mod-y', run: () => runHistoryCommand(mainView, redo) },
        { key: 'Mod-Shift-z', run: () => runHistoryCommand(mainView, redo) },
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
                const { from } = options.getSelectionBounds(nestedView);
                if (nestedView.state.selection.main.head === from) {
                    options.syncPendingChangesToRoot();
                    return navigateCell(mainView, 'previous', { initialCursorPos: 'end' });
                }
                return false;
            },
        },
        {
            key: 'ArrowRight',
            run: (nestedView) => {
                const { to } = options.getSelectionBounds(nestedView);
                if (nestedView.state.selection.main.head === to) {
                    options.syncPendingChangesToRoot();
                    return navigateCell(mainView, 'next', { initialCursorPos: 'start' });
                }
                return false;
            },
        },
        {
            key: 'ArrowUp',
            run: (nestedView) => {
                const { from } = options.getSelectionBounds(nestedView);
                const { head } = nestedView.state.selection.main;
                const headRect = nestedView.coordsAtPos(head);
                const fromRect = nestedView.coordsAtPos(from);

                if (headRect && fromRect && Math.abs(headRect.top - fromRect.top) < 2) {
                    options.syncPendingChangesToRoot();
                    return navigateCell(mainView, 'up', { initialCursorPos: 'lastLineStart' });
                }

                if (head === from) {
                    options.syncPendingChangesToRoot();
                    return navigateCell(mainView, 'up', { initialCursorPos: 'lastLineStart' });
                }

                return false;
            },
        },
        {
            key: 'ArrowDown',
            run: (nestedView) => {
                const { to } = options.getSelectionBounds(nestedView);
                const { head } = nestedView.state.selection.main;
                const headRect = nestedView.coordsAtPos(head);
                const toRect = nestedView.coordsAtPos(to);

                if (headRect && toRect && Math.abs(headRect.top - toRect.top) < 2) {
                    options.syncPendingChangesToRoot();
                    return navigateCell(mainView, 'down', { initialCursorPos: 'start' });
                }

                if (head === to) {
                    options.syncPendingChangesToRoot();
                    return navigateCell(mainView, 'down', { initialCursorPos: 'start' });
                }

                return false;
            },
        },
        {
            key: 'Shift-ArrowLeft',
            run: (nestedView) => {
                const { from } = options.getSelectionBounds(nestedView);
                if (nestedView.state.selection.main.head !== from) {
                    return false;
                }

                options.closeEditor();
                return startCellSelectionFromActiveCell(mainView, 'left');
            },
        },
        {
            key: 'Shift-ArrowRight',
            run: (nestedView) => {
                const { to } = options.getSelectionBounds(nestedView);
                if (nestedView.state.selection.main.head !== to) {
                    return false;
                }

                options.closeEditor();
                return startCellSelectionFromActiveCell(mainView, 'right');
            },
        },
        {
            key: 'Shift-ArrowUp',
            run: (nestedView) => {
                const { from } = options.getSelectionBounds(nestedView);
                const { head } = nestedView.state.selection.main;
                const headRect = nestedView.coordsAtPos(head);
                const fromRect = nestedView.coordsAtPos(from);

                if (!((headRect && fromRect && Math.abs(headRect.top - fromRect.top) < 2) || head === from)) {
                    return false;
                }

                options.closeEditor();
                return startCellSelectionFromActiveCell(mainView, 'up');
            },
        },
        {
            key: 'Shift-ArrowDown',
            run: (nestedView) => {
                const { to } = options.getSelectionBounds(nestedView);
                const { head } = nestedView.state.selection.main;
                const headRect = nestedView.coordsAtPos(head);
                const toRect = nestedView.coordsAtPos(to);

                if (!((headRect && toRect && Math.abs(headRect.top - toRect.top) < 2) || head === to)) {
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
    let pendingClipboardText: string | null = null;

    return [
        // Paste hits the root editor as an input.paste event and then gets sync'd back to nested editor
        EditorView.clipboardInputFilter.of((text) => {
            pendingClipboardText = text;
            return text;
        }),
        EditorView.inputHandler.of((_view, _from, _to, _text) => {
            if (pendingClipboardText === null) {
                return false;
            }

            const clipboardText = pendingClipboardText;
            pendingClipboardText = null;
            return handleTableClipboardTextPaste(clipboardText, mainView, {
                nestedEditorOpen: true,
            });
        }),
        EditorView.domEventHandlers({
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
            // Never marks the event as handled; the branches only decide whether the
            // keydown is allowed to bubble to the main editor and what to prepare first.
            keydown: (e) => {
                const isMod = e.ctrlKey || e.metaKey;
                const key = e.key.toLowerCase();

                if (isMod && key === 'f') {
                    // Search replaces the nested editor, so tear it down before the event bubbles.
                    options.closeEditor();
                    if (getActiveCell(mainView.state)) {
                        mainView.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                    }
                } else if (isMod && ROOT_COMMAND_KEYS.includes(key)) {
                    options.ensureRootSelectionForCommand();
                } else if (!(isMod && HOST_PASSTHROUGH_KEYS.includes(key))) {
                    // Everything else stays inside the nested editor.
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

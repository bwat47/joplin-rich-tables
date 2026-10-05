import type { Extension } from '@codemirror/state';
import { EditorView, keymap, type KeyBinding } from '@codemirror/view';
import type { NestedEditorInteractionControls } from '../../nestedEditor/nestedEditorController';
import { isCaretOnSameVisualLine } from '../../shared/caretVisualLine';
import { startCellSelectionFromActiveCell } from '../selection/cellSelectionController';
import { handleTableClipboardTextPaste } from '../selection/cellSelectionClipboard';
import { navigateCell } from '../navigation/tableNavigation';
import { createHistoryKeyBindings } from '../historyKeymap';

/** Table policy installed in a cell editor using the controller's session controls. */
export function createNestedEditorInteractionExtensions(
    mainView: EditorView,
    options: NestedEditorInteractionControls
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

    return [
        keymap.of(bindings),
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
        }),
    ];
}

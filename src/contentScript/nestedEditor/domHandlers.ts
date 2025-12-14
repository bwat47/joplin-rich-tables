import { EditorView, keymap } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { Transaction, StateEffect } from '@codemirror/state';

// Define a separate interface for the Joplin-specific extension
interface WithScrollSnapshot {
    scrollSnapshot?: () => StateEffect<unknown>;
}

/**
 * Creates a helper function that preserves the main editor's scroll position
 * while executing a callback (like undo/redo).
 */
function createPreserveScroll(mainView: EditorView) {
    return (fn: () => void) => {
        // In this CodeMirror build, `scrollSnapshot()` returns an effect that can
        // be dispatched later to restore the current scroll position.
        const view = mainView as unknown as WithScrollSnapshot;
        const snapshot = view.scrollSnapshot ? view.scrollSnapshot() : null;

        fn();

        if (snapshot) {
            // Undo/redo can restore an old selection which causes CodeMirror
            // to scroll the main editor into view. When editing via nested
            // editor we want to keep the viewport anchored where the user is.
            const restoreEffect = {
                effects: snapshot,
                annotations: Transaction.addToHistory.of(false),
            };

            // Apply immediately
            mainView.dispatch(restoreEffect);

            // Re-apply in rAF to override any later scroll-into-view measurement passes.
            requestAnimationFrame(() => {
                mainView.dispatch(restoreEffect);
            });
        }
    };
}

/** Creates a keymap for the nested editor to handle undo/redo. */
export function createNestedEditorKeymap(mainView: EditorView) {
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
    ]);
}

/** Creates DOM event handlers for the nested editor (keydown, contextmenu). */
export function createNestedEditorDomHandlers() {
    return EditorView.domEventHandlers({
        keydown: (e) => {
            // Never let key events bubble to the main editor. The main editor may still
            // have a selection outside the table, and handling Backspace/Delete there
            // would appear as "deleting outside the cell".
            e.stopPropagation();

            const isMod = e.ctrlKey || e.metaKey;
            if (isMod) {
                const key = e.key.toLowerCase();

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

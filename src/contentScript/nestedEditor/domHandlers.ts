import { EditorView } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { Transaction } from '@codemirror/state';

export function createNestedEditorDomHandlers(mainView: EditorView) {
    return EditorView.domEventHandlers({
        keydown: (e) => {
            // Never let key events bubble to the main editor. The main editor may still
            // have a selection outside the table, and handling Backspace/Delete there
            // would appear as "deleting outside the cell".
            e.stopPropagation();

            const isMod = e.ctrlKey || e.metaKey;
            if (isMod) {
                const key = e.key.toLowerCase();

                const preserveMainScroll = (fn: () => void) => {
                    // In this CodeMirror build, `scrollSnapshot()` returns an effect that can
                    // be dispatched later to restore the current scroll position.
                    const snapshot = mainView.scrollSnapshot();
                    fn();

                    // Undo/redo can restore an old selection which causes CodeMirror
                    // to scroll the main editor into view. When editing via nested
                    // editor we want to keep the viewport anchored where the user is.
                    //
                    // Restoring only in rAF can cause a visible one-frame scroll jump.
                    // Apply immediately, then re-apply in rAF to override any later
                    // scroll-into-view measurement passes.
                    mainView.dispatch({
                        effects: snapshot,
                        annotations: Transaction.addToHistory.of(false),
                    });

                    requestAnimationFrame(() => {
                        mainView.dispatch({
                            effects: snapshot,
                            annotations: Transaction.addToHistory.of(false),
                        });
                    });
                };

                // Forward undo/redo to main editor (subview has no history).
                if (key === 'z') {
                    e.stopPropagation();
                    e.preventDefault();
                    if (e.shiftKey) {
                        preserveMainScroll(() => redo(mainView));
                    } else {
                        preserveMainScroll(() => undo(mainView));
                    }
                    return true;
                }
                if (key === 'y') {
                    e.stopPropagation();
                    e.preventDefault();
                    preserveMainScroll(() => redo(mainView));
                    return true;
                }

                // Allow Ctrl+A/C/V/X which work correctly via browser/CodeMirror.
                const allowedKeys = ['a', 'c', 'v', 'x'];
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

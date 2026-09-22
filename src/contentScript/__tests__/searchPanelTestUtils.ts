import { openSearchPanel } from '@codemirror/search';
import type { EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** Runs a CodeMirror search command and returns the single transaction it dispatched. */
export function applySearchCommand(state: EditorState, command: (view: EditorView) => boolean): Transaction {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const transactions: Transaction[] = [];
    const view = new EditorView({
        parent,
        state,
        dispatch(transaction, editorView) {
            transactions.push(transaction);
            editorView.update([transaction]);
        },
    });

    try {
        if (!command(view)) {
            throw new Error('Expected the search command to run');
        }
        if (transactions.length !== 1) {
            throw new Error(`Expected one search transaction, received ${transactions.length}`);
        }
        return transactions[0];
    } finally {
        view.destroy();
        parent.remove();
    }
}

/** Opens CodeMirror's search panel and returns the resulting editor state. */
export function openSearchPanelInState(state: EditorState): EditorState {
    return applySearchCommand(state, openSearchPanel).state;
}

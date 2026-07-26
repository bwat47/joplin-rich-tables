import { Transaction } from '@codemirror/state';
import { syncAnnotation } from '../editorBridge/syncAnnotation';

export function hasSyncAnnotation(transactions: readonly Transaction[]): boolean {
    return transactions.some((tr) => tr.annotation(syncAnnotation));
}

/**
 * Detects a full document replacement transaction (e.g., external sync update).
 * This is typically a single change replacing [0, doc.length].
 */
export function isFullDocumentReplace(tr: Transaction): boolean {
    if (!tr.docChanged) {
        return false;
    }

    const docLength = tr.startState.doc.length;
    let changeCount = 0;
    let isFullReplace = false;

    tr.changes.iterChanges((fromA, toA) => {
        changeCount++;
        if (changeCount === 1 && fromA === 0 && toA === docLength) {
            isFullReplace = true;
        }
    });

    return isFullReplace && changeCount === 1;
}

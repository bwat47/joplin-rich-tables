import { EditorState, Extension } from '@codemirror/state';
import { clearActiveCellEffect } from '../tableWidget/activeCellState';
import { decideMainEditorGuardTransaction } from '../tableWidget/tableRuntimeTransitions';

/**
 * While a nested cell editor is open, Android can sometimes move focus/selection back
 * to the main editor and deliver Backspace as a main-editor edit. That can delete
 * table delimiter pipes and break the table.
 *
 * This guard rejects main-editor document changes that touch the active table but fall
 * outside the active cell range. Changes completely outside the table are allowed
 * (e.g., other plugins updating metadata elsewhere in the document).
 *
 * Allowed through without filtering:
 * - sync transactions forwarded from the nested editor (`syncAnnotation`)
 * - structural table operations that force a widget rebuild (`rebuildTableWidgetsEffect`)
 * - full document replacements (e.g., sync updates), handled by guard cleanup
 * - changes that don't overlap the active table at all
 *
 * It also *sanitizes* input inside the active cell (converting newlines to <br>)
 * to support context-menu paste operations which bypass the nested editor.
 */
export function createMainEditorActiveCellGuard(isNestedEditorOpen: () => boolean): Extension {
    const guardFilter = EditorState.transactionFilter.of((tr) => {
        const decision = decideMainEditorGuardTransaction(tr, { nestedEditorOpen: isNestedEditorOpen() });

        switch (decision.type) {
            case 'allowTransaction':
                return tr;
            case 'rejectTransaction':
                return [];
            case 'clearActiveCell':
                return {
                    changes: tr.changes,
                    selection: decision.selection,
                    effects: [...tr.effects, clearActiveCellEffect.of(undefined)],
                    scrollIntoView: tr.scrollIntoView,
                };
            case 'sanitizeTransactionChanges':
                return {
                    changes: decision.changes,
                    selection: decision.selection,
                    effects: tr.effects,
                    scrollIntoView: tr.scrollIntoView,
                };
        }
    });

    return guardFilter;
}

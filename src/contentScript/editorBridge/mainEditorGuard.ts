import { EditorState, Extension } from '@codemirror/state';
import { clearActiveCellEffect } from '../tableState/activeCellState';
import { activateInsertedTableEffect } from '../tableState/insertedTableActivation';
import { createTableClipboardRewriteSpec } from '../tableRuntime/cellSelectionClipboard';
import { decideMainEditorGuardTransaction } from './mainEditorGuardPolicy';

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
        const nestedEditorOpen = isNestedEditorOpen();

        const decision = decideMainEditorGuardTransaction(tr, { nestedEditorOpen });

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
            case 'rewriteTableClipboard':
                return createTableClipboardRewriteSpec(tr.startState, decision.rewrite);
            case 'rewriteRootTablePaste':
                return {
                    changes: decision.rewrite.changes,
                    selection: { anchor: decision.rewrite.selectionAnchor },
                    effects: [
                        ...tr.effects,
                        activateInsertedTableEffect.of({
                            tableFrom: decision.rewrite.tableFrom,
                            target: { section: 'header', row: 0, col: 0 },
                        }),
                    ],
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

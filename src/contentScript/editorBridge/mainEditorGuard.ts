import { EditorState, Extension } from '@codemirror/state';
import { clearActiveCellEffect } from '../tableState/activeCellState';
import { createFirstActiveCellForTable } from '../tableRuntime/activeCell/activeCellFactory';
import { prepareOpenCellRequestAttachment } from '../tableRuntime/openCellRequest';
import { createTableClipboardRewriteSpec } from '../tableRuntime/selection/cellSelectionClipboard';
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
 * - structural table operations (`structuralTableEditEffect`)
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
                    effects: [...tr.effects, clearActiveCellEffect.of(null)],
                    scrollIntoView: tr.scrollIntoView,
                };
            case 'rewriteTableClipboard':
                return createTableClipboardRewriteSpec(tr.startState, decision.rewrite);
            case 'rewriteRootTablePaste': {
                const nextActiveCell = createFirstActiveCellForTable({
                    tableFrom: decision.rewrite.tableFrom,
                    serialized: decision.rewrite.serialized,
                });
                if (!nextActiveCell) {
                    throw new Error('Pasted table must resolve header cell (0, 0)');
                }

                const openRequest = prepareOpenCellRequestAttachment({
                    activeCell: nextActiveCell.activeCell,
                    selectionAnchor: nextActiveCell.selectionAnchor,
                    suppressKeys: true,
                });

                return {
                    changes: decision.rewrite.changes,
                    ...openRequest,
                    effects: [...tr.effects, ...openRequest.effects],
                    scrollIntoView: tr.scrollIntoView,
                };
            }
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

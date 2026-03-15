import { EditorState, Extension, Transaction } from '@codemirror/state';
import { clearActiveCellEffect, getActiveCell } from '../tableWidget/activeCellState';
import { buildMultiCellPasteRewrite, createTableClipboardRewriteSpec } from '../tableWidget/cellSelectionClipboard';
import { decideMainEditorGuardTransaction } from '../tableWidget/tableRuntimeTransitions';

function extractSingleInsertedText(tr: Transaction): string | null {
    let insertedText: string | null = null;
    let changeCount = 0;

    tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
        changeCount++;
        if (changeCount === 1) {
            insertedText = inserted.toString();
        }
    });

    return changeCount === 1 && insertedText ? insertedText : null;
}

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

        if (nestedEditorOpen && tr.docChanged && tr.isUserEvent('input.paste')) {
            const activeCell = getActiveCell(tr.startState);
            const pastedText = extractSingleInsertedText(tr);

            if (activeCell && pastedText) {
                // Joplin can route Cmd/Ctrl+V to the root editor even while the nested
                // cell editor is visually focused. Upgrade valid markdown-table fragments
                // before the normal single-cell sanitation path turns them into text.
                const rewrite = buildMultiCellPasteRewrite(
                    tr.startState,
                    {
                        tableFrom: activeCell.tableFrom,
                        anchor: {
                            section: activeCell.section,
                            row: activeCell.row,
                            col: activeCell.col,
                        },
                        source: 'activeCell',
                    },
                    pastedText
                );

                if (rewrite) {
                    return createTableClipboardRewriteSpec(tr.startState, rewrite);
                }
            }
        }

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

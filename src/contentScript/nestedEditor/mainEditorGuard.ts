import { EditorSelection, EditorState, Extension, Transaction } from '@codemirror/state';
import { clearActiveCellEffect, getActiveCell } from '../tableWidget/activeCellState';
import { buildMultiCellPasteRewrite } from '../tableWidget/cellSelectionClipboard';
import { cellSelectionTransitionAnnotation, setCellSelectionEffect } from '../tableWidget/cellSelectionState';
import { resolveTableContextAtPos } from '../tableWidget/tablePositioning';
import { decideMainEditorGuardTransaction } from '../tableWidget/tableRuntimeTransitions';
import { logger } from '../../logger';

function extractSingleInsertedText(tr: Transaction): string | null {
    let insertedText: string | null = null;
    let sawChange = false;

    tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
        sawChange = true;
        if (insertedText !== null) {
            insertedText = null;
            return;
        }

        insertedText = inserted.toString();
    });

    if (!sawChange || insertedText === null || insertedText.length === 0) {
        return null;
    }

    let changeCount = 0;
    tr.changes.iterChanges(() => {
        changeCount++;
    });

    return changeCount === 1 ? insertedText : null;
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
                    const currentTable = resolveTableContextAtPos(tr.startState, rewrite.tableFrom);
                    logger.info('Main editor guard rewriting markdown-table paste while nested editor open');
                    return {
                        changes: {
                            from: rewrite.tableFrom,
                            to: currentTable?.to ?? rewrite.tableFrom,
                            insert: rewrite.tableText,
                        },
                        selection: EditorSelection.single(rewrite.selectionAnchorPos),
                        effects: [
                            setCellSelectionEffect.of(rewrite.selection),
                            clearActiveCellEffect.of(undefined),
                        ],
                        annotations: cellSelectionTransitionAnnotation.of(true),
                        scrollIntoView: false,
                    };
                }
            }
        }

        const decision = decideMainEditorGuardTransaction(tr, { nestedEditorOpen });

        if (tr.docChanged && nestedEditorOpen) {
            logger.info('Main editor guard saw doc change while nested editor open', {
                decision: decision.type,
                inputPaste: tr.isUserEvent('input.paste'),
                cut: tr.isUserEvent('delete.cut'),
                keyboard: tr.isUserEvent('input'),
            });
        }

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

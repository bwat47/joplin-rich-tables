import { ChangeSet, EditorSelection, Transaction } from '@codemirror/state';
import { getActiveCell } from '../tableState/activeCellState';
import { getCellSelection } from '../tableState/cellSelectionState';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { sanitizeCellChanges } from './cellTextCodec';
import { syncAnnotation } from './syncAnnotation';
import { getResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { isFullDocumentReplace } from '../shared/transactionUtils';
import { normalizeBeforeEditAnnotation } from '../tableRuntime/lifecycle/tableNormalization';
import {
    buildMultiCellPasteRewrite,
    type TableClipboardRewrite,
} from '../tableRuntime/selection/cellSelectionClipboard';
import {
    buildRootTablePasteRewrite,
    type RootTablePasteRewrite,
} from '../tableRuntime/operations/pasteTableNormalizer';
import { isEffectiveRawMode } from '../tableState/sourceMode';
import { mapSelectionRange } from '../tableRuntime/tableTransactionHelpers';

export type GuardDecision =
    | { type: 'allowTransaction' }
    | { type: 'rejectTransaction' }
    | { type: 'clearActiveCell'; selection: EditorSelection | undefined }
    | { type: 'rewriteTableClipboard'; rewrite: TableClipboardRewrite }
    | { type: 'rewriteRootTablePaste'; rewrite: RootTablePasteRewrite }
    | {
          type: 'sanitizeTransactionChanges';
          changes: ReturnType<typeof sanitizeCellChanges>['changes'];
          selection: EditorSelection;
      };

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

function extractSingleChangeRange(tr: Transaction): { from: number; to: number } | null {
    let changeRange: { from: number; to: number } | null = null;
    let changeCount = 0;

    tr.changes.iterChanges((fromA, toA) => {
        changeCount++;
        if (changeCount === 1) {
            changeRange = { from: fromA, to: toA };
        }
    });

    return changeCount === 1 ? changeRange : null;
}

function changesOverlapRange(tr: Transaction, from: number, to: number): boolean {
    let overlaps = false;
    tr.changes.iterChanges((fromA, toA) => {
        if (overlaps) {
            return;
        }
        if (fromA < to && toA > from) {
            overlaps = true;
        }
    });
    return overlaps;
}

export function decideMainEditorGuardTransaction(
    tr: Transaction,
    params: { nestedEditorOpen: boolean }
): GuardDecision {
    if (!tr.docChanged) {
        return { type: 'allowTransaction' };
    }

    if (tr.annotation(syncAnnotation)) {
        return { type: 'allowTransaction' };
    }

    if (tr.annotation(normalizeBeforeEditAnnotation)) {
        return { type: 'allowTransaction' };
    }

    if (tr.isUserEvent('input.paste')) {
        const pastedText = extractSingleInsertedText(tr);

        if (pastedText) {
            if (params.nestedEditorOpen) {
                const resolvedActiveCell = getResolvedActiveCell(tr.startState);

                if (resolvedActiveCell) {
                    const activeCell = resolvedActiveCell.activeCell;
                    const rewrite = buildMultiCellPasteRewrite(
                        tr.startState,
                        {
                            tableFrom: resolvedActiveCell.tableFrom,
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
                        return { type: 'rewriteTableClipboard', rewrite };
                    }
                }
            }

            if (!params.nestedEditorOpen && !getCellSelection(tr.startState) && !isEffectiveRawMode(tr.startState)) {
                const changeRange = extractSingleChangeRange(tr);
                if (changeRange) {
                    const rewrite = buildRootTablePasteRewrite(
                        tr.startState,
                        changeRange.from,
                        changeRange.to,
                        pastedText
                    );

                    if (rewrite) {
                        return { type: 'rewriteRootTablePaste', rewrite };
                    }
                }
            }
        }
    }

    const activeCell = getActiveCell(tr.startState);
    const resolvedActiveCell = getResolvedActiveCell(tr.startState);
    if (isFullDocumentReplace(tr)) {
        return activeCell
            ? { type: 'clearActiveCell', selection: tr.selection ?? undefined }
            : { type: 'allowTransaction' };
    }

    if (!params.nestedEditorOpen || !activeCell) {
        return { type: 'allowTransaction' };
    }

    if (!resolvedActiveCell) {
        return { type: 'clearActiveCell', selection: tr.selection ?? undefined };
    }

    if (tr.effects.some((effect) => effect.is(rebuildTableWidgetsEffect))) {
        return { type: 'allowTransaction' };
    }

    if (!changesOverlapRange(tr, resolvedActiveCell.tableFrom, resolvedActiveCell.tableTo)) {
        return { type: 'allowTransaction' };
    }

    const sanitized = sanitizeCellChanges(tr, resolvedActiveCell.editableFrom, resolvedActiveCell.editableTo);
    if (sanitized.rejected) {
        return { type: 'rejectTransaction' };
    }

    if (!sanitized.didModifyInserts) {
        return { type: 'allowTransaction' };
    }

    const changeSet = ChangeSet.of(sanitized.changes, tr.startState.doc.length);
    const selection = EditorSelection.create(
        tr.startState.selection.ranges.map((range) => mapSelectionRange(range, changeSet)),
        tr.startState.selection.mainIndex
    );

    return {
        type: 'sanitizeTransactionChanges',
        changes: sanitized.changes,
        selection,
    };
}

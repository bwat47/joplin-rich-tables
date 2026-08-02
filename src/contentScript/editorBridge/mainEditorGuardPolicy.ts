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

interface SingleChange {
    from: number;
    to: number;
    insertedText: string;
}

function extractSingleChange(tr: Transaction): SingleChange | null {
    let from = 0;
    let to = 0;
    let insertedText: string | null = null;
    let changeCount = 0;

    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        changeCount++;
        if (changeCount === 1) {
            from = fromA;
            to = toA;
            insertedText = inserted.toString();
        }
    });

    return changeCount === 1 && insertedText ? { from, to, insertedText } : null;
}

function decideNestedEditorPaste(tr: Transaction, pastedText: string, nestedEditorOpen: boolean): GuardDecision | null {
    if (!nestedEditorOpen) {
        return null;
    }

    const resolvedActiveCell = getResolvedActiveCell(tr.startState);
    if (!resolvedActiveCell) {
        return null;
    }

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

    return rewrite ? { type: 'rewriteTableClipboard', rewrite } : null;
}

function decideRootEditorPaste(tr: Transaction, change: SingleChange, nestedEditorOpen: boolean): GuardDecision | null {
    if (nestedEditorOpen || getCellSelection(tr.startState) || isEffectiveRawMode(tr.startState)) {
        return null;
    }

    const rewrite = buildRootTablePasteRewrite(tr.startState, change.from, change.to, change.insertedText);

    return rewrite ? { type: 'rewriteRootTablePaste', rewrite } : null;
}

function decidePasteTransaction(tr: Transaction, nestedEditorOpen: boolean): GuardDecision | null {
    if (!tr.isUserEvent('input.paste')) {
        return null;
    }

    const change = extractSingleChange(tr);
    if (!change) {
        return null;
    }

    return (
        decideNestedEditorPaste(tr, change.insertedText, nestedEditorOpen) ??
        decideRootEditorPaste(tr, change, nestedEditorOpen)
    );
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

    const pasteDecision = decidePasteTransaction(tr, params.nestedEditorOpen);
    if (pasteDecision) {
        return pasteDecision;
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

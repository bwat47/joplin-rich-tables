import { ChangeSet, EditorSelection, Transaction } from '@codemirror/state';
import { getActiveCell } from '../tableState/activeCellState';
import { getCellSelection } from '../tableState/cellSelectionState';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { sanitizeCellChanges } from './cellTextCodec';
import { syncAnnotation } from './syncAnnotation';
import { getResolvedActiveCell, type ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { isFullDocumentReplace } from '../shared/transactionUtils';
import { normalizeBeforeEditAnnotation } from '../tableRuntime/tableCanonicalForm';
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

function extractSinglePasteChange(tr: Transaction): SingleChange | null {
    let singleChange: SingleChange | null = null;
    let hasInsertedText = false;
    let changeCount = 0;

    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        changeCount++;
        if (changeCount === 1) {
            const insertedText = inserted.toString();
            singleChange = { from: fromA, to: toA, insertedText };
            hasInsertedText = insertedText.length > 0;
        }
    });

    return changeCount === 1 && hasInsertedText ? singleChange : null;
}

function decideNestedEditorPaste(tr: Transaction, pastedText: string): GuardDecision | null {
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

function decideRootEditorPaste(tr: Transaction, change: SingleChange): GuardDecision | null {
    if (getCellSelection(tr.startState) || isEffectiveRawMode(tr.startState)) {
        return null;
    }

    const rewrite = buildRootTablePasteRewrite(tr.startState, change.from, change.to, change.insertedText);

    return rewrite ? { type: 'rewriteRootTablePaste', rewrite } : null;
}

function decidePasteTransaction(tr: Transaction, nestedEditorOpen: boolean): GuardDecision | null {
    if (!tr.isUserEvent('input.paste')) {
        return null;
    }

    const change = extractSinglePasteChange(tr);
    if (!change) {
        return null;
    }

    return nestedEditorOpen ? decideNestedEditorPaste(tr, change.insertedText) : decideRootEditorPaste(tr, change);
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

function clearActiveCellDecision(tr: Transaction): GuardDecision {
    return { type: 'clearActiveCell', selection: tr.selection ?? undefined };
}

/**
 * Transactions the guard never inspects: they either carry no document change or are
 * already produced by the plugin itself (nested editor sync, normalize-before-edit).
 */
function isGuardBypassTransaction(tr: Transaction): boolean {
    return (
        !tr.docChanged ||
        Boolean(tr.annotation(syncAnnotation)) ||
        Boolean(tr.annotation(normalizeBeforeEditAnnotation))
    );
}

function decideFullDocumentReplace(tr: Transaction): GuardDecision | null {
    if (!isFullDocumentReplace(tr)) {
        return null;
    }

    return getActiveCell(tr.startState) ? clearActiveCellDecision(tr) : { type: 'allowTransaction' };
}

function decideCellSanitization(tr: Transaction, resolvedActiveCell: ResolvedActiveCell): GuardDecision {
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

/** Decides how to treat a main-editor edit while a nested cell editor holds an active cell. */
function decideActiveCellEdit(tr: Transaction): GuardDecision {
    const resolvedActiveCell = getResolvedActiveCell(tr.startState);
    if (!resolvedActiveCell) {
        return clearActiveCellDecision(tr);
    }

    if (tr.effects.some((effect) => effect.is(rebuildTableWidgetsEffect))) {
        return { type: 'allowTransaction' };
    }

    if (!changesOverlapRange(tr, resolvedActiveCell.tableFrom, resolvedActiveCell.tableTo)) {
        return { type: 'allowTransaction' };
    }

    return decideCellSanitization(tr, resolvedActiveCell);
}

export function decideMainEditorGuardTransaction(
    tr: Transaction,
    params: { nestedEditorOpen: boolean }
): GuardDecision {
    if (isGuardBypassTransaction(tr)) {
        return { type: 'allowTransaction' };
    }

    const pasteDecision = decidePasteTransaction(tr, params.nestedEditorOpen);
    if (pasteDecision) {
        return pasteDecision;
    }

    const fullReplaceDecision = decideFullDocumentReplace(tr);
    if (fullReplaceDecision) {
        return fullReplaceDecision;
    }

    if (!params.nestedEditorOpen || !getActiveCell(tr.startState)) {
        return { type: 'allowTransaction' };
    }

    return decideActiveCellEdit(tr);
}

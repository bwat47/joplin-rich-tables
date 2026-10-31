import { ChangeSet, EditorSelection, type Transaction } from '@codemirror/state';

import { syncAnnotation } from '../../shared/syncAnnotation';
import { isFullDocumentReplace } from '../../shared/transactionUtils';
import { getActiveCell } from '../../tableState/activeCellState';
import { getCellSelection, getSelectedTable } from '../../tableState/cellSelectionState';
import { getResolvedActiveCell, type ResolvedActiveCell } from '../../tableState/resolvedActiveCell';
import { isEffectiveRawMode } from '../../tableState/sourceMode';
import { structuralTableEditEffect } from '../../tableState/structuralTableEditEffect';
import { buildRootTablePasteRewrite, type RootTablePasteRewrite } from '../operations/pasteTableNormalizer';
import {
    buildMultiCellPasteRewrite,
    tableClipboardRewriteAnnotation,
    type TableClipboardRewrite,
} from '../selection/cellSelectionClipboard';
import { isEditConfinedToSelectedCells } from '../selection/cellSelectionEditScope';
import { normalizeBeforeEditAnnotation } from '../tableCanonicalForm';
import { sanitizeCellChanges } from './sanitizeCellChanges';

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
    let hasInsertedText = false as boolean;
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
        {
            ctx: resolvedActiveCell.ctx,
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

function clearActiveCellDecision(tr: Transaction): GuardDecision {
    return { type: 'clearActiveCell', selection: tr.selection ?? undefined };
}

/**
 * Transactions the guard never inspects: they either carry no document change or are
 * already produced by the plugin itself (nested editor sync, normalize-before-edit,
 * table clipboard rewrites).
 *
 * Clipboard rewrites replace the whole table by design, so without this bypass the
 * active-cell sanitization below would reject the ones dispatched from the document-level
 * clipboard capture while a nested editor is open.
 */
function isGuardBypassTransaction(tr: Transaction): boolean {
    return (
        !tr.docChanged ||
        Boolean(tr.annotation(syncAnnotation)) ||
        Boolean(tr.annotation(normalizeBeforeEditAnnotation)) ||
        Boolean(tr.annotation(tableClipboardRewriteAnnotation))
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
        tr.startState.selection.ranges.map((range) =>
            EditorSelection.range(changeSet.mapPos(range.anchor, 1), changeSet.mapPos(range.head, 1))
        ),
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

    if (tr.effects.some((effect) => effect.is(structuralTableEditEffect))) {
        return { type: 'allowTransaction' };
    }

    if (!tr.changes.touchesRange(resolvedActiveCell.ctx.from, resolvedActiveCell.ctx.to)) {
        return { type: 'allowTransaction' };
    }

    return decideCellSanitization(tr, resolvedActiveCell);
}

function isHistoryTransaction(tr: Transaction): boolean {
    return tr.isUserEvent('undo') || tr.isUserEvent('redo');
}

/**
 * Decides how to treat a main-editor edit while a cell selection is active, or returns null
 * when there is no resolvable selection.
 *
 * The selection parks one main-editor range per selected cell so host formatting commands
 * reach every cell. Commands that act on lines instead (headings, lists, quotes, code fences)
 * would write table syntax into the rows, so any edit touching the selected table must stay
 * inside the selected cells' text. History may revert a structural edit, and structural
 * commands rewrite the table on purpose, so both pass.
 */
function decideCellSelectionEdit(tr: Transaction): GuardDecision | null {
    const selected = getSelectedTable(tr.startState);
    if (!selected) {
        return null;
    }

    if (
        isHistoryTransaction(tr) ||
        tr.effects.some((effect) => effect.is(structuralTableEditEffect)) ||
        !tr.changes.touchesRange(selected.ctx.from, selected.ctx.to) ||
        isEditConfinedToSelectedCells(tr, selected)
    ) {
        return { type: 'allowTransaction' };
    }

    return { type: 'rejectTransaction' };
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

    // A drag keeps its anchor cell open alongside the selection; that cell's guard applies.
    if (!getActiveCell(tr.startState)) {
        const cellSelectionDecision = decideCellSelectionEdit(tr);
        if (cellSelectionDecision) {
            return cellSelectionDecision;
        }
    }

    if (!params.nestedEditorOpen || !getActiveCell(tr.startState)) {
        return { type: 'allowTransaction' };
    }

    return decideActiveCellEdit(tr);
}

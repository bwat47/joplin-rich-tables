import { ChangeSet, EditorState, Extension, Transaction } from '@codemirror/state';
import { clearActiveCellEffect, getActiveCell } from '../tableWidget/activeCellState';
import { rebuildTableWidgetsEffect } from '../tableWidget/tableWidgetEffects';
import { isFullDocumentReplace } from '../shared/transactionUtils';
import { sanitizeCellChanges, syncAnnotation } from './transactionPolicy';

/**
 * Check if any changes in the transaction touch the table range.
 * Returns true if at least one change overlaps [tableFrom, tableTo].
 */
function changesOverlapTable(tr: Transaction, tableFrom: number, tableTo: number): boolean {
    let overlaps = false;
    tr.changes.iterChanges((fromA, toA) => {
        if (overlaps) return;
        // Change overlaps table if: change.from < table.to AND change.to > table.from
        if (fromA < tableTo && toA > tableFrom) {
            overlaps = true;
        }
    });
    return overlaps;
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
 * - full document replacements (e.g., sync updates), handled by extender cleanup
 * - changes that don't overlap the active table at all
 *
 * It also *sanitizes* input inside the active cell (converting newlines to <br>)
 * to support context-menu paste operations which bypass the nested editor.
 */
export function createMainEditorActiveCellGuard(isNestedEditorOpen: () => boolean): Extension {
    const guardFilter = EditorState.transactionFilter.of((tr) => {
        if (!tr.docChanged) {
            return tr;
        }

        // Allow nested->main sync transactions through untouched.
        if (tr.annotation(syncAnnotation)) {
            return tr;
        }

        // Only guard when a nested editor is actually open.
        if (!isNestedEditorOpen()) {
            return tr;
        }

        const activeCell = getActiveCell(tr.startState);
        if (!activeCell) {
            return tr;
        }

        if (isFullDocumentReplace(tr)) {
            return tr;
        }

        // Toolbar operations replace the whole table (outside a single cell) intentionally.
        // Those dispatch `rebuildTableWidgetsEffect`.
        const forceRebuild = tr.effects.some((e) => e.is(rebuildTableWidgetsEffect));
        if (forceRebuild) {
            return tr;
        }

        // Allow changes that don't touch the active table at all.
        // This permits other plugins to update content elsewhere in the document
        // (e.g., updating a "Last Modified" timestamp or Table of Contents).
        if (!changesOverlapTable(tr, activeCell.tableFrom, activeCell.tableTo)) {
            return tr;
        }

        const { rejected, didModifyInserts, changes } = sanitizeCellChanges(tr, activeCell.cellFrom, activeCell.cellTo);

        if (rejected) {
            return [];
        }

        if (!didModifyInserts) {
            return tr;
        }

        // Return a new transaction with sanitized changes.
        // We must map the selection through the new changes explicitly to ensure
        // the cursor tracks the end of the insertion (assoc=1).
        const changeSet = ChangeSet.of(changes, tr.startState.doc.length);
        const newSelection = tr.startState.selection.map(changeSet, 1);

        return {
            changes,
            selection: newSelection,
            effects: tr.effects,
            scrollIntoView: tr.scrollIntoView,
        };
    });

    const fullReplaceExtender = EditorState.transactionExtender.of((tr) => {
        if (!tr.docChanged) {
            return null;
        }

        if (tr.annotation(syncAnnotation)) {
            return null;
        }

        if (!isNestedEditorOpen()) {
            return null;
        }

        if (!isFullDocumentReplace(tr)) {
            return null;
        }

        const activeCell = getActiveCell(tr.startState);
        if (!activeCell) {
            return null;
        }

        return {
            effects: [clearActiveCellEffect.of(undefined)],
        };
    });

    return [guardFilter, fullReplaceExtender];
}

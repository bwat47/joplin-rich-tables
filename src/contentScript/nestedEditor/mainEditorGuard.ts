import { ChangeSet, EditorState, Extension } from '@codemirror/state';
import { getActiveCell } from '../tableWidget/activeCellState';
import { rebuildTableWidgetsEffect } from '../tableWidget/tableWidgetEffects';
import { sanitizeCellChanges, syncAnnotation } from './transactionPolicy';

/**
 * While a nested cell editor is open, Android can sometimes move focus/selection back
 * to the main editor and deliver Backspace as a main-editor edit. That can delete
 * table delimiter pipes and break the table.
 *
 * This guard rejects any main-editor document changes that touch outside the active
 * cell range, while allowing:
 * - sync transactions forwarded from the nested editor (`syncAnnotation`)
 * - structural table operations that force a widget rebuild (`rebuildTableWidgetsEffect`)
 *
 * It also *sanitizes* input inside the active cell (main converting newlines to <br>)
 * to support context-menu paste operations which bypass the nested editor.
 */
export function createMainEditorActiveCellGuard(isNestedEditorOpen: () => boolean): Extension {
    return EditorState.transactionFilter.of((tr) => {
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

        // Toolbar operations replace the whole table (outside a single cell) intentionally.
        // Those dispatch `rebuildTableWidgetsEffect`.
        const forceRebuild = tr.effects.some((e) => e.is(rebuildTableWidgetsEffect));
        if (forceRebuild) {
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
}

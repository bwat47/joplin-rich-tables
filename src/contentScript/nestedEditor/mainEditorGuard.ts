import { EditorState, Extension } from '@codemirror/state';
import { getActiveCell } from '../tableWidget/activeCellState';
import { rebuildTableWidgetsEffect } from '../tableWidget/tableWidgetEffects';
import { syncAnnotation } from './transactionPolicy';

/**
 * While a nested cell editor is open, Android can sometimes move focus/selection back
 * to the main editor and deliver Backspace as a main-editor edit. That can delete
 * table delimiter pipes and break the table.
 *
 * This guard rejects any main-editor document changes that touch outside the active
 * cell range, while still allowing:
 * - sync transactions forwarded from the nested editor (`syncAnnotation`)
 * - structural table operations that force a widget rebuild (`rebuildTableWidgetsEffect`)
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

        let rejected = false;
        tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
            // Reject changes outside the active cell range.
            if (fromA < activeCell.cellFrom || toA > activeCell.cellTo) {
                rejected = true;
                return;
            }
            // Reject newlines (table cells cannot contain line breaks).
            const insertedText = inserted.toString();
            if (insertedText.includes('\n') || insertedText.includes('\r')) {
                rejected = true;
            }
        });

        return rejected ? [] : tr;
    });
}

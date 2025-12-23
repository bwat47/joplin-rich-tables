import { EditorState, Extension } from '@codemirror/state';
import { getActiveCell } from '../tableWidget/activeCellState';
import { rebuildTableWidgetsEffect } from '../tableWidget/tableWidgetEffects';
import {
    convertNewlinesToBr,
    countTrailingBackslashesInDoc,
    escapeUnescapedPipesWithContext,
    syncAnnotation,
} from './transactionPolicy';

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

        type SimpleChange = { from: number; to: number; insert: string };
        const nextChanges: SimpleChange[] = [];
        let rejected = false;
        let didModifyInserts = false;

        tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
            // Reject changes outside the active cell range.
            if (fromA < activeCell.cellFrom || toA > activeCell.cellTo) {
                rejected = true;
                return;
            }

            // Sanitize changes inside the active cell (e.g. Paste from context menu).
            const insertedText = inserted.toString();

            let sanitizedText = insertedText;
            if (sanitizedText.includes('\n') || sanitizedText.includes('\r')) {
                sanitizedText = convertNewlinesToBr(sanitizedText);
            }

            const escaped = sanitizedText.includes('|')
                ? escapeUnescapedPipesWithContext(
                      sanitizedText,
                      countTrailingBackslashesInDoc(tr.startState.doc, fromA)
                  )
                : sanitizedText;

            if (escaped !== insertedText) {
                didModifyInserts = true;
            }

            nextChanges.push({ from: fromA, to: toA, insert: escaped });
        });

        if (rejected) {
            return [];
        }

        if (!didModifyInserts) {
            return tr;
        }

        // Return a new transaction with sanitized changes.
        // CodeMirror automatically maps the selection through the new changes.
        return {
            changes: nextChanges,
            selection: tr.selection ? tr.selection : undefined,
            effects: tr.effects,
            scrollIntoView: tr.scrollIntoView,
        };
    });
}

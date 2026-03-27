import { EditorState, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { getActiveCell } from '../tableState/activeCellState';
import { getResolvedActiveCell } from './activeCell/resolvedActiveCellField';
import { isNestedEditorOpen } from '../nestedEditor/nestedEditorController';
import { transactionRequiresTableRebuild } from './lifecycle/lifecyclePolicy';

/**
 * Injects a scroll snapshot effect into undo/redo transactions while a nested
 * editor is open, preventing the viewport from jumping to the cursor position
 * inside the replaced table widget.
 *
 * Works for all undo sources (keyboard shortcut, toolbar button, native mobile
 * gesture) because it runs on the main editor's transaction extender, not the
 * nested editor's keymap.
 *
 * Structural changes (row/column mutations, cross-cell undos) are excluded --
 * those are handled by the lifecycle plugin's close/reopen flow.
 */
export function createUndoScrollPreservation(getView: () => EditorView): Extension {
    return EditorState.transactionExtender.of((tr) => {
        if (!tr.isUserEvent('undo') && !tr.isUserEvent('redo')) return null;

        const view = getView();
        if (!isNestedEditorOpen(view)) return null;

        const activeCell = getActiveCell(tr.startState);
        if (!activeCell) return null;

        const resolvedActiveCell = getResolvedActiveCell(tr.startState);
        if (transactionRequiresTableRebuild(tr, resolvedActiveCell)) return null;

        return { effects: view.scrollSnapshot() };
    });
}

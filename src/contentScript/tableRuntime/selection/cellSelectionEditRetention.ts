import { EditorState, type Extension, type Transaction } from '@codemirror/state';
import { setActiveCellEffect } from '../../tableState/activeCellState';
import { isCellDragInProgress } from '../../tableState/cellDragState';
import {
    clearCellSelectionEffect,
    getSelectedTable,
    setCellSelectionEffect,
    type CellSelection,
} from '../../tableState/cellSelectionState';
import { structuralTableEditEffect } from '../../tableState/structuralTableEditEffect';
import { isEditConfinedToSelectedCells } from './cellSelectionEditScope';

/** Effects that already decide what happens to the cell selection in this transaction. */
function decidesCellSelection(tr: Transaction): boolean {
    return tr.effects.some(
        (effect) =>
            effect.is(setCellSelectionEffect) ||
            effect.is(clearCellSelectionEffect) ||
            effect.is(setActiveCellEffect) ||
            effect.is(structuralTableEditEffect)
    );
}

/**
 * Returns the cell selection to keep across `tr`, or null when the edit should clear it.
 *
 * A cell selection is otherwise dropped by every document change. An edit confined to the
 * selected cells' text (`isEditConfinedToSelectedCells`) leaves every cell where it was, so
 * the selection still names the same cells and is kept. Such an edit starts after the row's
 * leading pipe, so the table start does not move.
 */
function retainedCellSelection(tr: Transaction): CellSelection | null {
    if (!tr.docChanged || decidesCellSelection(tr) || isCellDragInProgress(tr.startState)) {
        return null;
    }

    const selected = getSelectedTable(tr.startState);
    return selected && isEditConfinedToSelectedCells(tr.changes, selected) ? selected.selection : null;
}

/** Keeps a cell selection across edits confined to its cells' text. See `retainedCellSelection`. */
export const cellSelectionEditRetention: Extension = EditorState.transactionExtender.of((tr) => {
    const retained = retainedCellSelection(tr);
    return retained ? { effects: setCellSelectionEffect.of(retained) } : null;
});

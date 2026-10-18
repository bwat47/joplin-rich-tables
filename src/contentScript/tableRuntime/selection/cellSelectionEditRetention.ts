import { EditorState, type Extension, type Transaction } from '@codemirror/state';
import { setActiveCellEffect } from '../../tableState/activeCellState';
import { isCellDragInProgress } from '../../tableState/cellDragState';
import {
    clearCellSelectionEffect,
    getSelectedTable,
    setCellSelectionEffect,
    toSelectionRect,
    type CellSelection,
} from '../../tableState/cellSelectionState';
import { structuralTableEditEffect } from '../../tableState/structuralTableEditEffect';
import { collectSelectedCellRanges } from './cellSelectionRanges';

/**
 * Inserted characters that would change the table's structure: a line break ends the row
 * and a pipe starts a new cell, so the selection's coordinates would no longer name the
 * same cells.
 */
const STRUCTURAL_TABLE_CHARACTERS = /[\n|]/;

/** Keeps the start-side position for an insertion at the table start, which joins the table. */
const MAP_TO_TABLE_START = -1;

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
 * A cell selection is otherwise dropped by every document change. An edit that only rewrites
 * text inside the selected cells — a host formatting command applied to the per-cell ranges
 * from `cellSelectionRanges.ts`, or undoing one — leaves every cell where it was, so the
 * selection still names the same cells and is kept. Any change outside a selected cell's
 * editable text, or one that inserts a row or cell separator, clears it as before.
 */
function retainedCellSelection(tr: Transaction): CellSelection | null {
    if (!tr.docChanged || decidesCellSelection(tr) || isCellDragInProgress(tr.startState)) {
        return null;
    }

    const selected = getSelectedTable(tr.startState);
    if (!selected) {
        return null;
    }

    const { selection, ctx } = selected;
    const cells = collectSelectedCellRanges(ctx, toSelectionRect(selection));
    let confined = true;

    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        confined &&=
            !STRUCTURAL_TABLE_CHARACTERS.test(inserted.toString()) &&
            cells.some(({ range }) => ctx.from + range.editableFrom <= fromA && toA <= ctx.from + range.editableTo);
    });

    if (!confined) {
        return null;
    }

    return { ...selection, tableFrom: tr.changes.mapPos(selection.tableFrom, MAP_TO_TABLE_START) };
}

/** Keeps a cell selection across edits confined to its cells' text. See `retainedCellSelection`. */
export const cellSelectionEditRetention: Extension = EditorState.transactionExtender.of((tr) => {
    const retained = retainedCellSelection(tr);
    return retained ? { effects: setCellSelectionEffect.of(retained) } : null;
});

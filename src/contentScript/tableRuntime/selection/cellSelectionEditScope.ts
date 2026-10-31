import type { Transaction } from '@codemirror/state';

import { hasUnescapedPipe } from '../../tableModel/cellTextNormalization';
import { toSelectionRect, type SelectedTable } from '../../tableState/cellSelectionState';
import { cellTextFromContext, collectSelectedCellSpans, type SelectedCellSpan } from './cellSelectionRanges';

/** Keeps text inserted at a cell's edges inside that cell when mapping its span forward. */
const MAP_CELL_FROM_BACKWARD = -1;
const MAP_CELL_TO_FORWARD = 1;

const LINE_BREAK = /[\r\n]/;

/**
 * True when cell text would change the table's structure: a line break ends the row and an
 * unescaped pipe starts a new cell, so the selection's coordinates would no longer name the
 * same cells.
 */
function breaksTableStructure(cellText: string): boolean {
    return LINE_BREAK.test(cellText) || hasUnescapedPipe(cellText);
}

/**
 * True when every change in `tr` lies inside one selected cell's editable range and each cell
 * it touches still holds valid single-cell text afterwards.
 *
 * This is what makes an edit safe under a cell selection: a host formatting command applied
 * to the per-cell ranges from `cellSelectionRanges.ts` (or undoing one) leaves every cell
 * where it was. Line-based commands (headings, lists, quotes, code fences) write at row starts
 * or insert line breaks, so they fail it.
 *
 * The resulting text is checked rather than the inserted text: unwrapping a format re-inserts
 * the cell's content, escaped pipes included, while deleting the backslash of `\|` inserts
 * nothing yet exposes a separator.
 */
export function isEditConfinedToSelectedCells(tr: Transaction, selected: SelectedTable): boolean {
    const { selection, ctx } = selected;
    const cells = collectSelectedCellSpans(toSelectionRect(selection), cellTextFromContext(ctx));
    const touchedCells = new Set<SelectedCellSpan>();
    let confined = true as boolean;

    tr.changes.iterChanges((fromA, toA) => {
        const cell = cells.find((candidate) => candidate.from <= fromA && toA <= candidate.to);
        if (cell) {
            touchedCells.add(cell);
        } else {
            confined = false;
        }
    });

    if (!confined) {
        return false;
    }

    for (const cell of touchedCells) {
        const from = tr.changes.mapPos(cell.from, MAP_CELL_FROM_BACKWARD);
        const to = tr.changes.mapPos(cell.to, MAP_CELL_TO_FORWARD);
        if (breaksTableStructure(tr.newDoc.sliceString(from, to))) {
            return false;
        }
    }

    return true;
}

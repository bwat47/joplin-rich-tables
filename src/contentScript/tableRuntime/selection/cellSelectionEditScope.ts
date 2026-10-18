import type { ChangeSet } from '@codemirror/state';
import { toSelectionRect, type SelectedTable } from '../../tableState/cellSelectionState';
import { collectSelectedCellRanges } from './cellSelectionRanges';

/**
 * Inserted characters that would change the table's structure: a line break ends the row
 * and a pipe starts a new cell, so the selection's coordinates would no longer name the
 * same cells.
 */
const STRUCTURAL_TABLE_CHARACTERS = /[\n|]/;

/**
 * True when every change rewrites text inside one selected cell's editable range and
 * inserts no row or cell separator.
 *
 * This is what makes an edit safe under a cell selection: a host formatting command applied
 * to the per-cell ranges from `cellSelectionRanges.ts` (or undoing one) leaves every cell
 * where it was. Line-based commands (headings, lists, quotes, code fences) write at row starts
 * or insert line breaks, so they fail it.
 */
export function isEditConfinedToSelectedCells(changes: ChangeSet, selected: SelectedTable): boolean {
    const { selection, ctx } = selected;
    const cells = collectSelectedCellRanges(ctx, toSelectionRect(selection));
    let confined = true;

    changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        confined &&=
            !STRUCTURAL_TABLE_CHARACTERS.test(inserted.toString()) &&
            cells.some(({ range }) => ctx.from + range.editableFrom <= fromA && toA <= ctx.from + range.editableTo);
    });

    return confined;
}

import { EditorSelection, type SelectionRange } from '@codemirror/state';
import type { TableContext } from '../../tableModel/tableContext';
import { getCellRange, type CellRange } from '../../tableModel/markdownTableCellRanges';
import { fromUnifiedRow, isSameCellCoords, type CellCoords, type TableRect } from '../../tableModel/types';

/** A selected cell that has source text, with its table-relative range. */
export interface SelectedCellRange {
    coords: CellCoords;
    range: CellRange;
}

/** Lists the source-backed cells inside `rect`, row by row. Cells a ragged row is missing are skipped. */
export function collectSelectedCellRanges(ctx: TableContext, rect: TableRect): SelectedCellRange[] {
    const cells: SelectedCellRange[] = [];

    for (let row = rect.minRow; row <= rect.maxRow; row++) {
        for (let col = rect.minCol; col <= rect.maxCol; col++) {
            const coords = fromUnifiedRow(row, col);
            const range = getCellRange(ctx.cellRanges, coords);
            if (range) {
                cells.push({ coords, range });
            }
        }
    }

    return cells;
}

/**
 * Builds the main-editor selection that backs a rectangular cell selection: one range over
 * the editable text of every non-empty selected cell.
 *
 * The host's formatting commands (bold, italic, ...) apply to every selection range, so
 * spanning each cell's text lets them format the whole rectangle at once. Empty cells are
 * left out because formatting an empty range inserts bare markers (`****`).
 *
 * The focus cell's range is the main one, keeping `selection.main` inside the selected table
 * for the scope guard. When the focus cell is empty, the first range is main instead; when no
 * selected cell has text, the selection collapses to a caret at the focus cell's start.
 */
export function buildCellSelectionRanges(ctx: TableContext, rect: TableRect, focus: CellCoords): EditorSelection {
    const ranges: SelectionRange[] = [];
    let mainIndex = 0;

    for (const { coords, range } of collectSelectedCellRanges(ctx, rect)) {
        if (range.editableFrom === range.editableTo) {
            continue;
        }

        if (isSameCellCoords(coords, focus)) {
            mainIndex = ranges.length;
        }
        ranges.push(EditorSelection.range(ctx.from + range.editableFrom, ctx.from + range.editableTo));
    }

    if (ranges.length === 0) {
        const focusRange = getCellRange(ctx.cellRanges, focus);
        return EditorSelection.single(ctx.from + (focusRange?.editableFrom ?? 0));
    }

    return EditorSelection.create(ranges, mainIndex);
}

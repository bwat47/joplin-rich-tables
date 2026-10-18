import { EditorSelection, type SelectionRange } from '@codemirror/state';
import type { SerializedTable } from '../../tableModel/MarkdownTable';
import type { TableContext } from '../../tableModel/tableContext';
import { getCellRange } from '../../tableModel/markdownTableCellRanges';
import { fromUnifiedRow, isSameCellCoords, type CellCoords, type TableRect } from '../../tableModel/types';

/** A cell's editable text span, in document positions. */
interface CellTextSpan {
    from: number;
    to: number;
}

/** Looks up a cell's editable text span, or null for a cell the table does not have. */
export type CellTextLookup = (coords: CellCoords) => CellTextSpan | null;

/** A selected cell together with its editable text span. */
export interface SelectedCellSpan extends CellTextSpan {
    coords: CellCoords;
}

/** Cell text spans of an indexed table, from its parsed editable ranges. */
export function cellTextFromContext(ctx: TableContext): CellTextLookup {
    return (coords) => {
        const range = getCellRange(ctx.cellRanges, coords);
        return range ? { from: ctx.from + range.editableFrom, to: ctx.from + range.editableTo } : null;
    };
}

/**
 * Cell text spans of a table about to be written at `tableFrom`, from its serialization.
 *
 * Canonical serialization writes each cell's content between single-space pipe padding,
 * which is exactly the editable range the parser reports once the text is indexed.
 */
export function cellTextFromSerialized(tableFrom: number, serialized: SerializedTable): CellTextLookup {
    return (coords) => {
        const range = serialized.cellRange(coords);
        return range ? { from: tableFrom + range.from, to: tableFrom + range.to } : null;
    };
}

/** Lists the cells inside `rect` that the table has, row by row. Cells a ragged row is missing are skipped. */
export function collectSelectedCellSpans(rect: TableRect, cellText: CellTextLookup): SelectedCellSpan[] {
    const cells: SelectedCellSpan[] = [];

    for (let row = rect.minRow; row <= rect.maxRow; row++) {
        for (let col = rect.minCol; col <= rect.maxCol; col++) {
            const coords = fromUnifiedRow(row, col);
            const span = cellText(coords);
            if (span) {
                cells.push({ coords, ...span });
            }
        }
    }

    return cells;
}

/** What a cell selection's main-editor ranges are built from. */
export interface CellSelectionRangesParams {
    tableFrom: number;
    rect: TableRect;
    focus: CellCoords;
    cellText: CellTextLookup;
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
 * selected cell has text, the selection collapses to a caret at the focus cell's start (or the
 * table start, should the focus cell be missing).
 */
export function buildCellSelectionRanges(params: CellSelectionRangesParams): EditorSelection {
    const { tableFrom, rect, focus, cellText } = params;
    const ranges: SelectionRange[] = [];
    let mainIndex = 0;

    for (const { coords, from, to } of collectSelectedCellSpans(rect, cellText)) {
        if (from === to) {
            continue;
        }

        if (isSameCellCoords(coords, focus)) {
            mainIndex = ranges.length;
        }
        ranges.push(EditorSelection.range(from, to));
    }

    if (ranges.length === 0) {
        return EditorSelection.single(cellText(focus)?.from ?? tableFrom);
    }

    return EditorSelection.create(ranges, mainIndex);
}

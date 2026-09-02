import type { ClipboardTableFragment, TableAlignment } from './MarkdownTable';
import type { TableRect } from './types';

/** Cell-grid dimensions of a rectangular clipboard fragment or selection rectangle. */
interface GridSize {
    rowCount: number;
    colCount: number;
}

/** Null when the fragment is empty or ragged, i.e. it has no well-defined grid size. */
function measureFragment(fragment: ClipboardTableFragment): GridSize | null {
    const rowCount = fragment.cells.length;
    const colCount = fragment.cells[0]?.length ?? 0;

    if (rowCount <= 0 || colCount <= 0) {
        return null;
    }

    return fragment.cells.every((row) => row.length === colCount) ? { rowCount, colCount } : null;
}

function measureRect(rect: TableRect): GridSize {
    return {
        rowCount: rect.maxRow - rect.minRow + 1,
        colCount: rect.maxCol - rect.minCol + 1,
    };
}

/**
 * Repeats the fragment's alignments across the tiled width.
 *
 * Alignments only take effect for columns a paste creates, and repeated columns always
 * land inside the rectangle, hence inside the table. A paste can still create columns by
 * overflowing a fragment wider than the rectangle, but that case repeats the columns
 * once, leaving the alignments exactly as the fragment supplied them. Tiling them anyway
 * keeps the result a valid fragment on its own.
 */
function tileAlignments(
    alignments: readonly TableAlignment[],
    fragmentColCount: number,
    tiledColCount: number
): TableAlignment[] {
    return Array.from(
        { length: tiledColCount },
        (_value, col) => alignments[col % fragmentColCount] ?? null
    );
}

/**
 * The number of whole fragment repetitions that fit along one axis.
 *
 * Always at least one: a fragment wider or taller than the rectangle still pastes a
 * single complete copy, overflowing the selection the way an unsized paste does.
 */
function wholeRepetitions(available: number, fragmentLength: number): number {
    return Math.max(1, Math.floor(available / fragmentLength));
}

/**
 * Repeats a clipboard fragment to cover a selection rectangle.
 *
 * Only whole repetitions are written, so no copy is ever truncated mid-fragment: a 1x1
 * fragment fills any rectangle, a 2x2 fragment covers a 4x4 rectangle exactly, and the
 * same fragment over a 5x5 rectangle produces 4x4 and leaves the trailing row and column
 * alone. Callers set the post-paste selection from the region actually written, which is
 * what tells the user the rectangle was not an exact fit.
 *
 * Ragged or empty fragments, and rectangles that fit exactly one copy, are returned
 * unchanged for a single anchored paste.
 *
 * @example
 * // fragment [['A']] over rows 0-1, cols 0-1 -> [['A', 'A'], ['A', 'A']]
 */
export function tileFragmentToRect(fragment: ClipboardTableFragment, rect: TableRect): ClipboardTableFragment {
    const fragmentSize = measureFragment(fragment);
    if (!fragmentSize) {
        return fragment;
    }

    const available = measureRect(rect);
    const rowCount = wholeRepetitions(available.rowCount, fragmentSize.rowCount) * fragmentSize.rowCount;
    const colCount = wholeRepetitions(available.colCount, fragmentSize.colCount) * fragmentSize.colCount;

    if (rowCount === fragmentSize.rowCount && colCount === fragmentSize.colCount) {
        return fragment;
    }

    const cells = Array.from({ length: rowCount }, (_value, row) => {
        const sourceRow = fragment.cells[row % fragmentSize.rowCount];

        return Array.from({ length: colCount }, (_cell, col) => sourceRow[col % fragmentSize.colCount]);
    });

    return {
        cells,
        alignments: tileAlignments(fragment.alignments, fragmentSize.colCount, colCount),
    };
}

import { tileFragmentToRect } from '../tableModel/clipboardFragmentTiling';
import type { ClipboardTableFragment, TableAlignment } from '../tableModel/MarkdownTable';
import type { TableRect } from '../tableModel/types';

function fragment(cells: string[][], alignments?: TableAlignment[]): ClipboardTableFragment {
    return {
        cells,
        alignments: alignments ?? new Array<TableAlignment>(cells[0]?.length ?? 0).fill(null),
    };
}

/** A rectangle of the given size, offset so the tiling never depends on it starting at 0. */
function rect(rowCount: number, colCount: number): TableRect {
    const minRow = 1;
    const minCol = 2;

    return { minRow, maxRow: minRow + rowCount - 1, minCol, maxCol: minCol + colCount - 1 };
}

describe('tileFragmentToRect', () => {
    it('fills the whole rectangle from a single cell', () => {
        const result = tileFragmentToRect(fragment([['A']]), rect(2, 3));

        expect(result.cells).toEqual([
            ['A', 'A', 'A'],
            ['A', 'A', 'A'],
        ]);
    });

    it('repeats a fragment that divides the rectangle evenly on both axes', () => {
        const result = tileFragmentToRect(
            fragment([
                ['A', 'B'],
                ['C', 'D'],
            ]),
            rect(4, 4)
        );

        expect(result.cells).toEqual([
            ['A', 'B', 'A', 'B'],
            ['C', 'D', 'C', 'D'],
            ['A', 'B', 'A', 'B'],
            ['C', 'D', 'C', 'D'],
        ]);
    });

    it('repeats along one axis when the other already matches', () => {
        const result = tileFragmentToRect(fragment([['A', 'B']]), rect(3, 2));

        expect(result.cells).toEqual([
            ['A', 'B'],
            ['A', 'B'],
            ['A', 'B'],
        ]);
    });

    it('tiles the alignments alongside the cells', () => {
        const result = tileFragmentToRect(fragment([['A', 'B']], ['left', 'right']), rect(1, 4));

        expect(result.alignments).toEqual(['left', 'right', 'left', 'right']);
    });

    it('covers only the whole repetitions that fit when the rectangle is not an exact multiple', () => {
        const result = tileFragmentToRect(
            fragment([
                ['A', 'B'],
                ['C', 'D'],
            ]),
            rect(5, 5)
        );

        expect(result.cells).toEqual([
            ['A', 'B', 'A', 'B'],
            ['C', 'D', 'C', 'D'],
            ['A', 'B', 'A', 'B'],
            ['C', 'D', 'C', 'D'],
        ]);
    });

    it('repeats an axis that fits while overflowing one that does not', () => {
        const result = tileFragmentToRect(fragment([['A'], ['B'], ['C']]), rect(2, 4));

        expect(result.cells).toEqual([
            ['A', 'A', 'A', 'A'],
            ['B', 'B', 'B', 'B'],
            ['C', 'C', 'C', 'C'],
        ]);
    });

    it('leaves the fragment alone when only a single copy fits', () => {
        const source = fragment([
            ['A', 'B'],
            ['C', 'D'],
        ]);

        expect(tileFragmentToRect(source, rect(1, 1))).toBe(source);
        expect(tileFragmentToRect(source, rect(3, 3))).toBe(source);
    });

    it('leaves ragged or empty fragments alone', () => {
        const ragged = fragment([['A', 'B'], ['C']]);
        const empty = fragment([]);

        expect(tileFragmentToRect(ragged, rect(2, 2))).toBe(ragged);
        expect(tileFragmentToRect(empty, rect(2, 2))).toBe(empty);
    });
});

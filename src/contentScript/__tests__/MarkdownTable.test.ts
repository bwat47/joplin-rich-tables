import { MarkdownTable } from '../tableModel/MarkdownTable';
import { buildTableContext } from '../tableModel/tableContext';

describe('MarkdownTable', () => {
    it('parse returns normalized state for ragged tables', () => {
        const table = MarkdownTable.parse(['| H |', '| --- |', '| A | B |'].join('\n'));

        expect(table).not.toBeNull();
        expect(table!.headerCells).toEqual(['H', '']);
        expect(table!.alignments).toEqual([null, null]);
        expect(table!.bodyRows).toEqual([['A', 'B']]);
    });

    it('fromParts normalizes ragged input', () => {
        const table = MarkdownTable.fromParts({
            headerCells: ['H1'],
            alignments: [null, 'right'],
            bodyRows: [['A', 'B', 'C']],
        });

        expect(table.headerCells).toEqual(['H1', '', '']);
        expect(table.alignments).toEqual([null, 'right', null]);
        expect(table.bodyRows).toEqual([['A', 'B', 'C']]);
    });

    it('serializes using minimal spacing and current alignment tokens', () => {
        const table = MarkdownTable.fromParts({
            headerCells: ['H1', 'H2', 'H3', 'H4'],
            alignments: ['left', 'right', 'center', null],
            bodyRows: [['a', 'b', 'c', 'd']],
        });

        expect(table.serialize()).toBe(
            ['| H1 | H2 | H3 | H4 |', '| :--- | ---: | :---: | --- |', '| a | b | c | d |'].join('\n')
        );
    });

    it('keeps passive table-context builds side-effect free for non-canonical markdown', () => {
        const text = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');
        const ctx = buildTableContext({ from: 0, to: text.length, text });

        expect(ctx).not.toBeNull();
        expect(ctx?.text).toBe(text);
        expect(ctx?.table.serialize()).toBe(['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n'));
    });

    it('returns same instance for no-op methods', () => {
        const table = MarkdownTable.fromParts({
            headerCells: ['H1', 'H2'],
            alignments: [null, null],
            bodyRows: [['A', 'B']],
        });

        expect(table.deleteColumn(5)).toBe(table);
        expect(table.deleteRowAt('body', 2)).toBe(table);
        expect(table.updateColumnAlignment(0, null)).toBe(table);
        expect(table.clearRow('body', 2)).toBe(table);
        expect(table.clearColumn(9)).toBe(table);
        expect(table.moveRow('header', 0, 'up')).toBe(table);
    });

    it('keeps header semantics for row operations', () => {
        const table = MarkdownTable.fromParts({
            headerCells: ['H1', 'H2'],
            alignments: ['left', 'right'],
            bodyRows: [
                ['A1', 'A2'],
                ['B1', 'B2'],
            ],
        });

        const insertedBeforeHeader = table.insertRowRelativeTo('header', 0, 'before');
        expect(insertedBeforeHeader.headerCells).toEqual(['', '']);
        expect(insertedBeforeHeader.bodyRows[0]).toEqual(['H1', 'H2']);

        const deletedHeader = table.deleteRowAt('header', 0);
        expect(deletedHeader.headerCells).toEqual(['A1', 'A2']);
        expect(deletedHeader.bodyRows).toEqual([['B1', 'B2']]);

        const movedHeaderDown = table.moveRow('header', 0, 'down');
        expect(movedHeaderDown.headerCells).toEqual(['A1', 'A2']);
        expect(movedHeaderDown.bodyRows[0]).toEqual(['H1', 'H2']);
    });

    it('swapColumns preserves alignments', () => {
        const table = MarkdownTable.fromParts({
            headerCells: ['Left', 'Center', 'Right'],
            alignments: ['left', 'center', 'right'],
            bodyRows: [['A', 'B', 'C']],
        });

        const next = table.swapColumns(0, 2);
        expect(next.headerCells).toEqual(['Right', 'Center', 'Left']);
        expect(next.alignments).toEqual(['right', 'center', 'left']);
        expect(next.bodyRows).toEqual([['C', 'B', 'A']]);
    });

    it('clear operations preserve structure and alignments', () => {
        const table = MarkdownTable.fromParts({
            headerCells: ['H1', 'H2'],
            alignments: ['left', 'right'],
            bodyRows: [
                ['A1', 'A2'],
                ['B1', 'B2'],
            ],
        });

        const clearedRow = table.clearRow('body', 0);
        expect(clearedRow.alignments).toEqual(['left', 'right']);
        expect(clearedRow.bodyRows).toEqual([
            ['', ''],
            ['B1', 'B2'],
        ]);

        const clearedAll = table.clearAllCells();
        expect(clearedAll.alignments).toEqual(['left', 'right']);
        expect(clearedAll.headerCells).toEqual(['', '']);
        expect(clearedAll.bodyRows).toEqual([
            ['', ''],
            ['', ''],
        ]);
    });

    it('clears rectangular selections across header and body rows', () => {
        const table = MarkdownTable.fromParts({
            headerCells: ['H1', 'H2', 'H3'],
            alignments: ['left', 'center', 'right'],
            bodyRows: [
                ['A1', 'A2', 'A3'],
                ['B1', 'B2', 'B3'],
            ],
        });

        const next = table.clearRect({
            minRow: 0,
            maxRow: 2,
            minCol: 1,
            maxCol: 1,
        });

        expect(next.headerCells).toEqual(['H1', '', 'H3']);
        expect(next.bodyRows).toEqual([
            ['A1', '', 'A3'],
            ['B1', '', 'B3'],
        ]);
        expect(next.alignments).toEqual(['left', 'center', 'right']);
    });

    it('detects when a rectangular selection is entirely empty', () => {
        const table = MarkdownTable.fromParts({
            headerCells: ['H1', '', 'H3'],
            alignments: ['left', 'center', 'right'],
            bodyRows: [
                ['A1', '', 'A3'],
                ['B1', '', 'B3'],
            ],
        });

        expect(
            table.isRectEmpty({
                minRow: 0,
                maxRow: 2,
                minCol: 1,
                maxCol: 1,
            })
        ).toBe(true);
        expect(
            table.isRectEmpty({
                minRow: 1,
                maxRow: 2,
                minCol: 0,
                maxCol: 1,
            })
        ).toBe(false);
    });

    it('deletes contiguous unified body rows', () => {
        const table = MarkdownTable.fromParts({
            headerCells: ['H1', 'H2'],
            alignments: ['left', 'right'],
            bodyRows: [
                ['A1', 'A2'],
                ['B1', 'B2'],
                ['C1', 'C2'],
            ],
        });

        const next = table.deleteUnifiedRowRange(1, 2);

        expect(next.headerCells).toEqual(['H1', 'H2']);
        expect(next.bodyRows).toEqual([['C1', 'C2']]);
        expect(next.alignments).toEqual(['left', 'right']);
    });

    it('promotes the first surviving body row when deleting a row range that includes the header', () => {
        const table = MarkdownTable.fromParts({
            headerCells: ['H1', 'H2'],
            alignments: ['left', 'right'],
            bodyRows: [
                ['A1', 'A2'],
                ['B1', 'B2'],
                ['C1', 'C2'],
            ],
        });

        const next = table.deleteUnifiedRowRange(0, 1);

        expect(next.headerCells).toEqual(['B1', 'B2']);
        expect(next.bodyRows).toEqual([['C1', 'C2']]);
        expect(next.alignments).toEqual(['left', 'right']);
    });

    it('deletes contiguous column ranges while preserving remaining alignments', () => {
        const table = MarkdownTable.fromParts({
            headerCells: ['H1', 'H2', 'H3', 'H4'],
            alignments: ['left', 'center', 'right', null],
            bodyRows: [
                ['A1', 'A2', 'A3', 'A4'],
                ['B1', 'B2', 'B3', 'B4'],
            ],
        });

        const next = table.deleteColumnRange(1, 2);

        expect(next.headerCells).toEqual(['H1', 'H4']);
        expect(next.bodyRows).toEqual([
            ['A1', 'A4'],
            ['B1', 'B4'],
        ]);
        expect(next.alignments).toEqual(['left', null]);
    });

    it('allows header-only results while still blocking removal of every row or every column', () => {
        const table = MarkdownTable.fromParts({
            headerCells: ['H1', 'H2'],
            alignments: ['left', 'right'],
            bodyRows: [['A1', 'A2']],
        });

        const headerOnly = table.deleteUnifiedRowRange(1, 1);
        const promotedHeaderOnly = table.deleteUnifiedRowRange(0, 0);

        expect(headerOnly.headerCells).toEqual(['H1', 'H2']);
        expect(headerOnly.bodyRows).toEqual([]);
        expect(promotedHeaderOnly.headerCells).toEqual(['A1', 'A2']);
        expect(promotedHeaderOnly.bodyRows).toEqual([]);
        expect(table.deleteUnifiedRowRange(0, 1)).toBe(table);
        expect(table.deleteColumnRange(0, 1)).toBe(table);
    });

    it('pastes a fragment within existing bounds', () => {
        const table = MarkdownTable.fromParts({
            headerCells: ['H1', 'H2', 'H3'],
            alignments: ['left', 'center', 'right'],
            bodyRows: [
                ['A1', 'A2', 'A3'],
                ['B1', 'B2', 'B3'],
            ],
        });

        const result = table.pasteFragmentAt(
            { section: 'body', row: 0, col: 1 },
            {
                cells: [
                    ['P1', 'P2'],
                    ['Q1', 'Q2'],
                ],
                alignments: [null, 'right'],
            }
        );

        expect(result).not.toBeNull();
        expect(result?.pastedRect).toEqual({
            minRow: 1,
            maxRow: 2,
            minCol: 1,
            maxCol: 2,
        });
        expect(result?.table.headerCells).toEqual(['H1', 'H2', 'H3']);
        expect(result?.table.bodyRows).toEqual([
            ['A1', 'P1', 'P2'],
            ['B1', 'Q1', 'Q2'],
        ]);
        expect(result?.table.alignments).toEqual(['left', 'center', 'right']);
    });

    it('expands rows and columns when pasted content exceeds current bounds', () => {
        const table = MarkdownTable.fromParts({
            headerCells: ['H1', 'H2'],
            alignments: ['left', 'right'],
            bodyRows: [['A1', 'A2']],
        });

        const result = table.pasteFragmentAt(
            { section: 'body', row: 0, col: 1 },
            {
                cells: [
                    ['P1', 'P2', 'P3'],
                    ['Q1', 'Q2', 'Q3'],
                ],
                alignments: ['left', 'center', 'right'],
            }
        );

        expect(result).not.toBeNull();
        expect(result?.pastedRect).toEqual({
            minRow: 1,
            maxRow: 2,
            minCol: 1,
            maxCol: 3,
        });
        expect(result?.table.headerCells).toEqual(['H1', 'H2', '', '']);
        expect(result?.table.bodyRows).toEqual([
            ['A1', 'P1', 'P2', 'P3'],
            ['', 'Q1', 'Q2', 'Q3'],
        ]);
        expect(result?.table.alignments).toEqual(['left', 'right', 'center', 'right']);
    });

    it('treats pasted row zero as header only when anchored on the header', () => {
        const table = MarkdownTable.fromParts({
            headerCells: ['H1', 'H2'],
            alignments: ['left', 'right'],
            bodyRows: [['A1', 'A2']],
        });

        const result = table.pasteFragmentAt(
            { section: 'header', row: 0, col: 0 },
            {
                cells: [
                    ['NH1', 'NH2'],
                    ['NB1', 'NB2'],
                ],
                alignments: ['center', 'left'],
            }
        );

        expect(result?.pastedRect).toEqual({
            minRow: 0,
            maxRow: 1,
            minCol: 0,
            maxCol: 1,
        });
        expect(result?.table.headerCells).toEqual(['NH1', 'NH2']);
        expect(result?.table.bodyRows).toEqual([['NB1', 'NB2']]);
        expect(result?.table.alignments).toEqual(['left', 'right']);
    });
});

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
});

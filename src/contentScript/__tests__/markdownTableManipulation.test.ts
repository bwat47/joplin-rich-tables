import { MarkdownTable } from '../tableModel/MarkdownTable';

function parseTable(text: string): MarkdownTable {
    const table = MarkdownTable.parse(text);
    expect(table).not.toBeNull();
    return table!;
}

describe('markdownTableManipulation', () => {
    const basicTable = `
| Header 1 | Header 2 |
| :--- | ---: |
| Row 1 Col 1 | Row 1 Col 2 |
| Row 2 Col 1 | Row 2 Col 2 |
`.trim();

    it('should serialize table correctly (roundtrip)', () => {
        const table = parseTable(basicTable);
        const serialized = table.serialize();
        const reparsed = parseTable(serialized);

        expect(reparsed.headerCells).toEqual(table.headerCells);
        expect(reparsed.alignments).toEqual(table.alignments);
        expect(reparsed.bodyRows).toEqual(table.bodyRows);
    });

    it('should serialize from model-native parts', () => {
        const table = MarkdownTable.fromParts({
            headerCells: ['H1', 'H2'],
            alignments: ['left', null],
            bodyRows: [['A', 'B']],
        });

        expect(table.serialize()).toBe(['| H1 | H2 |', '| :--- | --- |', '| A | B |'].join('\n'));
    });

    it('should insert row before', () => {
        const table = parseTable(basicTable);
        const next = table.insertRowRelativeTo('body', 0, 'before');

        expect(next.bodyRows.length).toBe(3);
        expect(next.bodyRows[0]).toEqual(['', '']);
        expect(next.bodyRows[1]).toEqual(['Row 1 Col 1', 'Row 1 Col 2']);
    });

    it('should insert row after', () => {
        const table = parseTable(basicTable);
        const next = table.insertRowRelativeTo('body', 0, 'after');

        expect(next.bodyRows.length).toBe(3);
        expect(next.bodyRows[0]).toEqual(['Row 1 Col 1', 'Row 1 Col 2']);
        expect(next.bodyRows[1]).toEqual(['', '']);
        expect(next.bodyRows[2]).toEqual(['Row 2 Col 1', 'Row 2 Col 2']);
    });

    it('should delete row', () => {
        const table = parseTable(basicTable);
        const next = table.deleteRowAt('body', 0);

        expect(next.bodyRows.length).toBe(1);
        expect(next.bodyRows[0]).toEqual(['Row 2 Col 1', 'Row 2 Col 2']);
    });

    it('should insert column before', () => {
        const table = parseTable(basicTable);
        const next = table.insertColumn(1, 'before');

        expect(next.headerCells.length).toBe(3);
        expect(next.headerCells).toEqual(['Header 1', '', 'Header 2']);
        expect(next.alignments[1]).toBeNull();
        expect(next.bodyRows[0]).toEqual(['Row 1 Col 1', '', 'Row 1 Col 2']);
    });

    it('should insert column after', () => {
        const table = parseTable(basicTable);
        const next = table.insertColumn(0, 'after');

        expect(next.headerCells).toEqual(['Header 1', '', 'Header 2']);
        expect(next.bodyRows[0]).toEqual(['Row 1 Col 1', '', 'Row 1 Col 2']);
    });

    it('should delete column', () => {
        const table = parseTable(basicTable);
        const next = table.deleteColumn(0);

        expect(next.headerCells.length).toBe(1);
        expect(next.headerCells[0]).toBe('Header 2');
        expect(next.bodyRows[0].length).toBe(1);
        expect(next.bodyRows[0][0]).toBe('Row 1 Col 2');
    });

    it('should not delete last remaining column', () => {
        const table = parseTable(['| H |', '| --- |', '| A |', '| B |'].join('\n'));
        const next = table.deleteColumn(0);

        expect(next).toBe(table);
        expect(next.headerCells).toEqual(['H']);
        expect(next.bodyRows.length).toBe(2);
    });

    it('should not delete last remaining body row', () => {
        const table = parseTable(['| H1 | H2 |', '| --- | --- |', '| A | B |'].join('\n'));
        const next = table.deleteRowAt('body', 0);

        expect(next).toBe(table);
        expect(next.bodyRows.length).toBe(1);
    });

    it('should preserve extra row cells by expanding headers on serialize', () => {
        const table = parseTable(['| H |', '| --- |', '| A | B |'].join('\n'));
        expect(table.headerCells).toEqual(['H', '']);
        expect(table.bodyRows[0]).toEqual(['A', 'B']);

        const reparsed = parseTable(table.serialize());
        expect(reparsed.headerCells.length).toBe(2);
        expect(reparsed.bodyRows[0]).toEqual(['A', 'B']);
    });

    it('should serialize with minimal single-space padding around pipes', () => {
        const table = parseTable(['| H1 | H2 |', '| --- | --- |', '| abc | def |'].join('\n'));
        const serialized = table.serialize();

        expect(serialized).toContain('| abc | def |');
        expect(serialized).not.toContain('| abc  |');
        expect(serialized).not.toContain('|  abc |');
    });

    describe('swapRows', () => {
        it('should swap two adjacent body rows', () => {
            const table = parseTable(basicTable);
            const next = table.swapRows(0, 1);

            expect(next.headerCells).toEqual(['Header 1', 'Header 2']);
            expect(next.bodyRows.length).toBe(2);
            expect(next.bodyRows[0]).toEqual(['Row 2 Col 1', 'Row 2 Col 2']);
            expect(next.bodyRows[1]).toEqual(['Row 1 Col 1', 'Row 1 Col 2']);
        });

        it('should swap header with first body row (row index -1 with 0)', () => {
            const table = parseTable(basicTable);
            const next = table.swapRows(-1, 0);

            expect(next.headerCells).toEqual(['Row 1 Col 1', 'Row 1 Col 2']);
            expect(next.alignments).toEqual(['left', 'right']);
            expect(next.bodyRows.length).toBe(2);
            expect(next.bodyRows[0]).toEqual(['Header 1', 'Header 2']);
            expect(next.bodyRows[1]).toEqual(['Row 2 Col 1', 'Row 2 Col 2']);
        });

        it('should return same table for out of bounds indices', () => {
            const table = parseTable(basicTable);
            const next = table.swapRows(0, 10);

            expect(next).toBe(table);
        });

        it('should return same table for invalid negative index (not -1)', () => {
            const table = parseTable(basicTable);
            const next = table.swapRows(-2, 0);

            expect(next).toBe(table);
        });

        it('should handle swapping in a table with different column counts', () => {
            const table = parseTable(['| H1 | H2 |', '| --- | --- |', '| A | B | C |', '| D | E |'].join('\n'));
            const next = table.swapRows(0, 1);

            expect(next.bodyRows[0]).toEqual(['D', 'E', '']);
            expect(next.bodyRows[1]).toEqual(['A', 'B', 'C']);
        });
    });

    describe('swapColumns', () => {
        it('should swap two adjacent columns', () => {
            const table = parseTable(basicTable);
            const next = table.swapColumns(0, 1);

            expect(next.headerCells).toEqual(['Header 2', 'Header 1']);
            expect(next.alignments).toEqual(['right', 'left']);
            expect(next.bodyRows[0]).toEqual(['Row 1 Col 2', 'Row 1 Col 1']);
            expect(next.bodyRows[1]).toEqual(['Row 2 Col 2', 'Row 2 Col 1']);
        });

        it('should swap first and last column in a 3-column table', () => {
            const table = parseTable(['| H1 | H2 | H3 |', '| :--- | :---: | ---: |', '| A | B | C |', '| D | E | F |'].join('\n'));
            const next = table.swapColumns(0, 2);

            expect(next.headerCells).toEqual(['H3', 'H2', 'H1']);
            expect(next.alignments).toEqual(['right', 'center', 'left']);
            expect(next.bodyRows[0]).toEqual(['C', 'B', 'A']);
            expect(next.bodyRows[1]).toEqual(['F', 'E', 'D']);
        });

        it('should return same table for out of bounds column index', () => {
            const table = parseTable(basicTable);
            const next = table.swapColumns(0, 5);

            expect(next).toBe(table);
        });

        it('should return same table for negative column index', () => {
            const table = parseTable(basicTable);
            const next = table.swapColumns(-1, 0);

            expect(next).toBe(table);
        });

        it('should handle swapping in a single column table (no-op)', () => {
            const table = parseTable(['| H |', '| --- |', '| A |', '| B |'].join('\n'));
            const next = table.swapColumns(0, 0);

            expect(next).toBe(table);
            expect(next.headerCells).toEqual(['H']);
            expect(next.bodyRows[0]).toEqual(['A']);
            expect(next.bodyRows[1]).toEqual(['B']);
        });

        it('should preserve alignment when swapping columns', () => {
            const table = parseTable(['| Left | Center | Right |', '| :--- | :---: | ---: |', '| A | B | C |'].join('\n'));
            const next = table.swapColumns(0, 2);

            expect(next.headerCells).toEqual(['Right', 'Center', 'Left']);
            expect(next.alignments).toEqual(['right', 'center', 'left']);
            expect(next.bodyRows[0]).toEqual(['C', 'B', 'A']);
        });
    });

    describe('clearAllCells', () => {
        it('should clear all header and body cell contents', () => {
            const table = parseTable(basicTable);
            const next = table.clearAllCells();

            expect(next.headerCells).toEqual(['', '']);
            expect(next.bodyRows).toEqual([
                ['', ''],
                ['', ''],
            ]);
        });

        it('should preserve alignments', () => {
            const table = parseTable(['| Left | Right |', '| :--- | ---: |', '| A | B |'].join('\n'));
            const next = table.clearAllCells();

            expect(next.alignments).toEqual(['left', 'right']);
        });

        it('should preserve row and column count', () => {
            const table = parseTable(basicTable);
            const next = table.clearAllCells();

            expect(next.headerCells.length).toBe(table.headerCells.length);
            expect(next.bodyRows.length).toBe(table.bodyRows.length);
            expect(next.bodyRows[0].length).toBe(table.bodyRows[0].length);
        });

        it('should be idempotent on an already-empty table', () => {
            const table = parseTable(['|  |  |', '| --- | --- |', '|  |  |'].join('\n'));
            const next = table.clearAllCells();

            expect(next.headerCells).toEqual(['', '']);
            expect(next.bodyRows).toEqual([['', '']]);
        });
    });

    describe('clearRow', () => {
        it('should clear the header row when section is header', () => {
            const table = parseTable(basicTable);
            const next = table.clearRow('header', 0);

            expect(next.headerCells).toEqual(['', '']);
            expect(next.bodyRows).toEqual(table.bodyRows);
            expect(next.alignments).toEqual(table.alignments);
        });

        it('should clear a body row by index', () => {
            const table = parseTable(basicTable);
            const next = table.clearRow('body', 1);

            expect(next.bodyRows[0]).toEqual(['Row 1 Col 1', 'Row 1 Col 2']);
            expect(next.bodyRows[1]).toEqual(['', '']);
            expect(next.headerCells).toEqual(table.headerCells);
            expect(next.alignments).toEqual(table.alignments);
        });

        it('should no-op for out of bounds body row', () => {
            const table = parseTable(basicTable);
            const next = table.clearRow('body', 10);

            expect(next).toBe(table);
        });
    });

    describe('clearColumn', () => {
        it('should clear the selected column in headers and body rows', () => {
            const table = parseTable(basicTable);
            const next = table.clearColumn(1);

            expect(next.headerCells).toEqual(['Header 1', '']);
            expect(next.bodyRows).toEqual([
                ['Row 1 Col 1', ''],
                ['Row 2 Col 1', ''],
            ]);
            expect(next.alignments).toEqual(table.alignments);
        });

        it('should no-op for out of bounds column', () => {
            const table = parseTable(basicTable);
            const next = table.clearColumn(10);

            expect(next).toBe(table);
        });

        it('should clear existing cells only for uneven rows', () => {
            const table = parseTable(['| H1 |', '| --- |', '| A | B |'].join('\n'));
            const next = table.clearColumn(1);

            expect(next.headerCells).toEqual(['H1', '']);
            expect(next.bodyRows[0]).toEqual(['A', '']);
        });
    });
});

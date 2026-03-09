import { MarkdownTable } from '../tableModel/MarkdownTable';
import { deleteRowForActiveCell, insertRowForActiveCell } from '../tableCommands/tableCommandSemantics';
import { computeActiveCellForTableText } from '../tableModel/activeCellForTableText';

function sliceCellText(tableText: string, cellFrom: number, cellTo: number): string {
    return tableText.slice(cellFrom, cellTo);
}

describe('cursorTrackingIntegration', () => {
    const baseMarkdown = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '| b1 | b2 |'].join('\n');

    test('insert row after moves to new row cell', () => {
        const tableFrom = 0;
        const active = computeActiveCellForTableText({
            tableFrom,
            tableText: baseMarkdown,
            target: { section: 'body', row: 0, col: 1 },
        });
        expect(active).not.toBeNull();

        const table = MarkdownTable.parse(baseMarkdown);
        expect(table).not.toBeNull();

        const newTable = insertRowForActiveCell(table!, active!, 'after');
        const newText = newTable.serialize();

        const next = computeActiveCellForTableText({
            tableFrom,
            tableText: newText,
            target: { section: 'body', row: 1, col: 1 },
        });

        expect(next).not.toBeNull();
        expect(next!.section).toBe('body');
        expect(next!.row).toBe(1);
        expect(next!.col).toBe(1);
        expect(sliceCellText(newText, next!.cellFrom, next!.cellTo)).toBe('');
    });

    test('delete row moves to next row (same index)', () => {
        const tableFrom = 0;
        const active = computeActiveCellForTableText({
            tableFrom,
            tableText: baseMarkdown,
            target: { section: 'body', row: 0, col: 1 },
        });
        expect(active).not.toBeNull();

        const table = MarkdownTable.parse(baseMarkdown);
        expect(table).not.toBeNull();

        const newTable = deleteRowForActiveCell(table!, active!);
        const newText = newTable.serialize();

        const next = computeActiveCellForTableText({
            tableFrom,
            tableText: newText,
            target: { section: 'body', row: 0, col: 1 },
        });

        expect(next).not.toBeNull();
        expect(sliceCellText(newText, next!.cellFrom, next!.cellTo)).toBe('b2');
    });

    test('insert column before moves to new column cell', () => {
        const tableFrom = 0;
        const active = computeActiveCellForTableText({
            tableFrom,
            tableText: baseMarkdown,
            target: { section: 'body', row: 0, col: 1 },
        });
        expect(active).not.toBeNull();

        const table = MarkdownTable.parse(baseMarkdown);
        expect(table).not.toBeNull();

        const newTable = table!.insertColumn(active!.col, 'before');
        const newText = newTable.serialize();

        const next = computeActiveCellForTableText({
            tableFrom,
            tableText: newText,
            target: { section: 'body', row: 0, col: 1 },
        });

        expect(next).not.toBeNull();
        expect(next!.col).toBe(1);
        expect(sliceCellText(newText, next!.cellFrom, next!.cellTo)).toBe('');
    });

    test('delete column moves to next column (same index)', () => {
        const tableFrom = 0;
        const active = computeActiveCellForTableText({
            tableFrom,
            tableText: baseMarkdown,
            target: { section: 'body', row: 0, col: 0 },
        });
        expect(active).not.toBeNull();

        const table = MarkdownTable.parse(baseMarkdown);
        expect(table).not.toBeNull();

        const newTable = table!.deleteColumn(active!.col);
        const newText = newTable.serialize();

        const next = computeActiveCellForTableText({
            tableFrom,
            tableText: newText,
            target: { section: 'body', row: 0, col: 0 },
        });

        expect(next).not.toBeNull();
        expect(sliceCellText(newText, next!.cellFrom, next!.cellTo)).toBe('a2');
    });

    test('alignment change keeps current cell', () => {
        const tableFrom = 0;
        const active = computeActiveCellForTableText({
            tableFrom,
            tableText: baseMarkdown,
            target: { section: 'body', row: 1, col: 1 },
        });
        expect(active).not.toBeNull();

        const table = MarkdownTable.parse(baseMarkdown);
        expect(table).not.toBeNull();

        const newTable = table!.updateColumnAlignment(active!.col, 'right');
        const newText = newTable.serialize();

        const next = computeActiveCellForTableText({
            tableFrom,
            tableText: newText,
            target: { section: 'body', row: 1, col: 1 },
        });

        expect(next).not.toBeNull();
        expect(next!.section).toBe('body');
        expect(next!.row).toBe(1);
        expect(next!.col).toBe(1);
        expect(sliceCellText(newText, next!.cellFrom, next!.cellTo)).toBe('b2');
    });
});

import { MarkdownTable } from '../tableModel/MarkdownTable';
import { computeActiveCellForTableText } from '../tableModel/activeCellForTableText';
import { computeMarkdownTableCellRanges, getCellRange } from '../tableModel/markdownTableCellRanges';
import type { ActiveCell } from '../tableWidget/activeCellState';

function sliceCellText(tableText: string, activeCell: ActiveCell): string {
    const ranges = computeMarkdownTableCellRanges(tableText);
    if (!ranges) {
        throw new Error('Expected table ranges');
    }

    const range = getCellRange(ranges, activeCell);
    if (!range) {
        throw new Error('Expected cell range');
    }

    return tableText.slice(range.from, range.to);
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

        const newTable = table!.insertRowRelativeTo(active!.section, active!.row, 'after');
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
        expect(sliceCellText(newText, next!)).toBe('');
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

        const newTable = table!.deleteRowAt(active!.section, active!.row);
        const newText = newTable.serialize();

        const next = computeActiveCellForTableText({
            tableFrom,
            tableText: newText,
            target: { section: 'body', row: 0, col: 1 },
        });

        expect(next).not.toBeNull();
        expect(sliceCellText(newText, next!)).toBe('b2');
    });

    test('delete last remaining body row falls back to the header cell', () => {
        const tableFrom = 0;
        const tableText = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const active = computeActiveCellForTableText({
            tableFrom,
            tableText,
            target: { section: 'body', row: 0, col: 1 },
        });
        expect(active).not.toBeNull();

        const table = MarkdownTable.parse(tableText);
        expect(table).not.toBeNull();

        const newTable = table!.deleteRowAt(active!.section, active!.row);
        const newText = newTable.serialize();

        const next = computeActiveCellForTableText({
            tableFrom,
            tableText: newText,
            target: { section: 'body', row: 0, col: 1 },
        });

        expect(next).not.toBeNull();
        expect(next!.section).toBe('header');
        expect(next!.row).toBe(0);
        expect(next!.col).toBe(1);
        expect(sliceCellText(newText, next!)).toBe('H2');
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
        expect(sliceCellText(newText, next!)).toBe('');
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
        expect(sliceCellText(newText, next!)).toBe('a2');
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
        expect(sliceCellText(newText, next!)).toBe('b2');
    });
});

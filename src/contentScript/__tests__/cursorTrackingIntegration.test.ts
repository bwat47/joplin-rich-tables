import { MarkdownTable } from '../tableModel/MarkdownTable';
import { computeMarkdownTableCellRanges, getCellRange } from '../tableModel/markdownTableCellRanges';
import { createActiveCellForTableText } from '../tableRuntime/activeCell/activeCellFactory';
import type { ActiveCell } from '../tableState/activeCellState';

const BASE_MARKDOWN = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '| b1 | b2 |'].join('\n');
const TABLE_FROM = 0;

type CellTarget = Pick<ActiveCell, 'section' | 'row' | 'col'>;

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

function requireActiveCell(tableText: string, target: CellTarget): ActiveCell {
    const activeCell = createActiveCellForTableText({
        tableFrom: TABLE_FROM,
        tableText,
        target,
    })?.activeCell;

    if (!activeCell) {
        throw new Error('Expected active cell');
    }

    return activeCell;
}

function parseTable(tableText: string): MarkdownTable {
    const table = MarkdownTable.parse(tableText);
    if (!table) {
        throw new Error('Expected parsed table');
    }

    return table;
}

function runCursorScenario(params: {
    tableText?: string;
    activeTarget: CellTarget;
    mutate: (table: MarkdownTable, activeCell: ActiveCell) => MarkdownTable;
    nextTarget: CellTarget;
}): { newText: string; next: ActiveCell } {
    const tableText = params.tableText ?? BASE_MARKDOWN;
    const activeCell = requireActiveCell(tableText, params.activeTarget);
    const newText = params.mutate(parseTable(tableText), activeCell).serialize();

    return {
        newText,
        next: requireActiveCell(newText, params.nextTarget),
    };
}

describe('cursorTrackingIntegration', () => {
    test('insert row after moves to new row cell', () => {
        const { newText, next } = runCursorScenario({
            activeTarget: { section: 'body', row: 0, col: 1 },
            mutate: (table, activeCell) => table.insertRowRelativeTo(activeCell.section, activeCell.row, 'after'),
            nextTarget: { section: 'body', row: 1, col: 1 },
        });

        expect(next.section).toBe('body');
        expect(next.row).toBe(1);
        expect(next.col).toBe(1);
        expect(sliceCellText(newText, next)).toBe('');
    });

    test('delete row moves to next row (same index)', () => {
        const { newText, next } = runCursorScenario({
            activeTarget: { section: 'body', row: 0, col: 1 },
            mutate: (table, activeCell) => table.deleteRowAt(activeCell.section, activeCell.row),
            nextTarget: { section: 'body', row: 0, col: 1 },
        });

        expect(sliceCellText(newText, next)).toBe('b2');
    });

    test('delete last remaining body row falls back to the header cell', () => {
        const tableText = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const { newText, next } = runCursorScenario({
            tableText,
            activeTarget: { section: 'body', row: 0, col: 1 },
            mutate: (table, activeCell) => table.deleteRowAt(activeCell.section, activeCell.row),
            nextTarget: { section: 'body', row: 0, col: 1 },
        });

        expect(next.section).toBe('header');
        expect(next.row).toBe(0);
        expect(next.col).toBe(1);
        expect(sliceCellText(newText, next)).toBe('H2');
    });

    test('insert column before moves to new column cell', () => {
        const { newText, next } = runCursorScenario({
            activeTarget: { section: 'body', row: 0, col: 1 },
            mutate: (table, activeCell) => table.insertColumn(activeCell.col, 'before'),
            nextTarget: { section: 'body', row: 0, col: 1 },
        });

        expect(next.col).toBe(1);
        expect(sliceCellText(newText, next)).toBe('');
    });

    test('delete column moves to next column (same index)', () => {
        const { newText, next } = runCursorScenario({
            activeTarget: { section: 'body', row: 0, col: 0 },
            mutate: (table, activeCell) => table.deleteColumn(activeCell.col),
            nextTarget: { section: 'body', row: 0, col: 0 },
        });

        expect(sliceCellText(newText, next)).toBe('a2');
    });

    test('alignment change keeps current cell', () => {
        const { newText, next } = runCursorScenario({
            activeTarget: { section: 'body', row: 1, col: 1 },
            mutate: (table, activeCell) => table.updateColumnAlignment(activeCell.col, 'right'),
            nextTarget: { section: 'body', row: 1, col: 1 },
        });

        expect(next.section).toBe('body');
        expect(next.row).toBe(1);
        expect(next.col).toBe(1);
        expect(sliceCellText(newText, next)).toBe('b2');
    });
});

import { parseMarkdownTable } from '../tableModel/markdownTableParsing';
import type { ActiveCell } from '../tableWidget/activeCellState';
import { deleteRowForActiveCell, insertRowForActiveCell } from '../toolbar/tableToolbarSemantics';

/**
 * These tests validate the header-row semantics used by the floating toolbar.
 * They are expressed as pure TableData transforms so they remain stable and fast.
 */

describe('table toolbar header-row semantics (TableData)', () => {
    it('Row+ After on header inserts empty first body row', () => {
        const text = `
| H1 | H2 |
| --- | --- |
| A1 | A2 |
| B1 | B2 |
`.trim();

        const table = parseMarkdownTable(text)!;

        const cell: ActiveCell = {
            tableFrom: 0,
            tableTo: 0,
            cellFrom: 0,
            cellTo: 0,
            section: 'header',
            row: 0,
            col: 0,
        };
        const updated = insertRowForActiveCell(table, cell, 'after');

        expect(updated.headers).toEqual(['H1', 'H2']);
        expect(updated.rows.length).toBe(3);
        expect(updated.rows[0]).toEqual(['', '']);
        expect(updated.rows[1]).toEqual(['A1', 'A2']);
    });

    it('Row+ Before on header creates empty header and demotes old header to first body row', () => {
        const text = `
| H1 | H2 |
| --- | --- |
| A1 | A2 |
`.trim();

        const table = parseMarkdownTable(text)!;

        const cell: ActiveCell = {
            tableFrom: 0,
            tableTo: 0,
            cellFrom: 0,
            cellTo: 0,
            section: 'header',
            row: 0,
            col: 0,
        };
        const updated = insertRowForActiveCell(table, cell, 'before');

        expect(updated.headers).toEqual(['', '']);
        expect(updated.rows.length).toBe(2);
        expect(updated.rows[0]).toEqual(['H1', 'H2']);
        expect(updated.rows[1]).toEqual(['A1', 'A2']);
    });

    it('Row- on header promotes first body row to header, unless it would create header-only table', () => {
        const text = `
| H1 | H2 |
| --- | --- |
| A1 | A2 |
| B1 | B2 |
`.trim();

        const table = parseMarkdownTable(text)!;

        const cell: ActiveCell = {
            tableFrom: 0,
            tableTo: 0,
            cellFrom: 0,
            cellTo: 0,
            section: 'header',
            row: 0,
            col: 0,
        };
        const updated = deleteRowForActiveCell(table, cell);

        expect(updated.headers).toEqual(['A1', 'A2']);
        expect(updated.rows.length).toBe(1);
        expect(updated.rows[0]).toEqual(['B1', 'B2']);

        const oneBodyRowText = `
| H1 | H2 |
| --- | --- |
| A1 | A2 |
`.trim();

        const oneBodyRow = parseMarkdownTable(oneBodyRowText)!;
        const updatedOneRow = deleteRowForActiveCell(oneBodyRow, cell);
        // Disallow: would result in header-only table.
        expect(updatedOneRow).toBe(oneBodyRow);
    });
});

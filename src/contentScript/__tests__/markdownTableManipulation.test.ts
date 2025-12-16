import { parseMarkdownTable } from '../tableModel/markdownTableParsing';
import {
    insertRow,
    deleteRow,
    insertColumn,
    deleteColumn,
    serializeTable,
} from '../tableModel/markdownTableManipulation';

describe('markdownTableManipulation', () => {
    const basicTable = `
| Header 1 | Header 2 |
| :--- | ---: |
| Row 1 Col 1 | Row 1 Col 2 |
| Row 2 Col 1 | Row 2 Col 2 |
`.trim();

    it('should serialize table correctly (roundtrip)', () => {
        const data = parseMarkdownTable(basicTable)!;
        const serialized = serializeTable(data);

        // Serialization might change whitespace/padding, so we check structure primarily.
        // Or we can check if it parses back to same data.

        const data2 = parseMarkdownTable(serialized)!;
        expect(data2.headers).toEqual(data.headers);
        expect(data2.alignments).toEqual(data.alignments);
        expect(data2.rows).toEqual(data.rows);
    });

    it('should insert row before', () => {
        const data = parseMarkdownTable(basicTable)!;
        const newData = insertRow(data, 0, 'before');

        expect(newData.rows.length).toBe(3);
        expect(newData.rows[0]).toEqual(['', '']);
        expect(newData.rows[1]).toEqual(['Row 1 Col 1', 'Row 1 Col 2']);
    });

    it('should insert row after', () => {
        const data = parseMarkdownTable(basicTable)!;
        const newData = insertRow(data, 0, 'after'); // Insert after first row

        expect(newData.rows.length).toBe(3);
        expect(newData.rows[0]).toEqual(['Row 1 Col 1', 'Row 1 Col 2']);
        expect(newData.rows[1]).toEqual(['', '']);
        expect(newData.rows[2]).toEqual(['Row 2 Col 1', 'Row 2 Col 2']);
    });

    it('should delete row', () => {
        const data = parseMarkdownTable(basicTable)!;
        const newData = deleteRow(data, 0);

        expect(newData.rows.length).toBe(1);
        expect(newData.rows[0]).toEqual(['Row 2 Col 1', 'Row 2 Col 2']);
    });

    it('should insert column before', () => {
        const data = parseMarkdownTable(basicTable)!;
        const newData = insertColumn(data, 1, 'before'); // Insert before 2nd col

        expect(newData.headers.length).toBe(3);
        expect(newData.headers).toEqual(['Header 1', '', 'Header 2']);
        expect(newData.alignments[1]).toBeNull();
        expect(newData.rows[0]).toEqual(['Row 1 Col 1', '', 'Row 1 Col 2']);
    });

    it('should insert column after', () => {
        const data = parseMarkdownTable(basicTable)!;
        const newData = insertColumn(data, 0, 'after'); // Insert after 1st col

        expect(newData.headers).toEqual(['Header 1', '', 'Header 2']);
        expect(newData.rows[0]).toEqual(['Row 1 Col 1', '', 'Row 1 Col 2']);
    });

    it('should delete column', () => {
        const data = parseMarkdownTable(basicTable)!;
        const newData = deleteColumn(data, 0);

        expect(newData.headers.length).toBe(1);
        expect(newData.headers[0]).toBe('Header 2');
        expect(newData.rows[0].length).toBe(1);
        expect(newData.rows[0][0]).toBe('Row 1 Col 2');
    });

    it('should not delete last remaining column', () => {
        const oneColTable = `
| H |
| --- |
| A |
| B |
`.trim();

        const data = parseMarkdownTable(oneColTable)!;
        const newData = deleteColumn(data, 0);

        // No-op
        expect(newData).toBe(data);
        expect(newData.headers).toEqual(['H']);
        expect(newData.rows.length).toBe(2);
    });

    it('should not delete last remaining body row', () => {
        const oneBodyRowTable = `
| H1 | H2 |
| --- | --- |
| A | B |
`.trim();

        const data = parseMarkdownTable(oneBodyRowTable)!;
        const newData = deleteRow(data, 0);

        // No-op
        expect(newData).toBe(data);
        expect(newData.rows.length).toBe(1);
    });

    it('should preserve extra row cells by expanding headers on serialize', () => {
        const inconsistentTable = `
| H |
| --- |
| A | B |
`.trim();

        const data = parseMarkdownTable(inconsistentTable)!;
        expect(data.headers).toEqual(['H']);
        expect(data.rows[0]).toEqual(['A', 'B']);

        const serialized = serializeTable(data);
        const reparsed = parseMarkdownTable(serialized)!;

        // Missing header/alignments are created as empty/null so we don't drop data.
        expect(reparsed.headers.length).toBe(2);
        expect(reparsed.rows[0]).toEqual(['A', 'B']);
    });

    it('should serialize with minimal single-space padding around pipes', () => {
        const text = `
| H1 | H2 |
| --- | --- |
| abc | def |
`.trim();

        const data = parseMarkdownTable(text)!;
        const serialized = serializeTable(data);

        // No extra spacing beyond the single spaces around delimiters.
        expect(serialized).toContain('| abc | def |');
        expect(serialized).not.toContain('| abc  |');
        expect(serialized).not.toContain('|  abc |');
    });
});

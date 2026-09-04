import { describe, expect, it } from 'vitest';
import { parseRootMarkdownTableSyntax } from '../tableModel/lezerTableSyntax';

function parse(text: string) {
    const parsed = parseRootMarkdownTableSyntax(text);
    expect(parsed).not.toBeNull();
    if (!parsed) {
        throw new Error('Expected a root table');
    }
    return parsed;
}

function cellContent(text: string, tableFrom: number, cell: { content: { from: number; to: number } | null }): string {
    return cell.content ? text.slice(tableFrom + cell.content.from, tableFrom + cell.content.to) : '';
}

describe('parseRootMarkdownTableSyntax', () => {
    it('extracts table-relative row and cell syntax', () => {
        const text = ['| A | B |', '| --- | --- |', '| C | D |'].join('\n');
        const parsed = parse(text);

        expect(parsed).toMatchObject({ from: 0, to: text.length });
        expect(parsed.syntax.header.cells.map((cell) => cellContent(text, parsed.from, cell))).toEqual(['A', 'B']);
        expect(parsed.syntax.bodyRows[0].cells.map((cell) => cellContent(text, parsed.from, cell))).toEqual(['C', 'D']);
    });

    it('reconstructs adjacent empty cells from delimiter positions', () => {
        const text = ['|| B |', '| --- | --- |', '|||'].join('\n');
        const parsed = parse(text);

        expect(parsed.syntax.header.cells).toHaveLength(2);
        expect(parsed.syntax.header.cells.map((cell) => cellContent(text, parsed.from, cell))).toEqual(['', 'B']);
        expect(parsed.syntax.bodyRows[0].cells).toHaveLength(2);
        expect(parsed.syntax.bodyRows[0].cells.every((cell) => cell.content === null)).toBe(true);
    });

    it('keeps escaped pipes inside a cell', () => {
        const text = [String.raw`| A\|B | C |`, '| --- | --- |'].join('\n');
        const parsed = parse(text);

        expect(parsed.syntax.header.cells.map((cell) => cellContent(text, parsed.from, cell))).toEqual([
            String.raw`A\|B`,
            'C',
        ]);
    });

    it('associates ordered content nodes across a wide row', () => {
        const expectedCells = Array.from({ length: 128 }, (_value, index) => `C${index}`);
        const text = [`| ${expectedCells.join(' | ')} |`, `| ${expectedCells.map(() => '---').join(' | ')} |`].join(
            '\n'
        );
        const parsed = parse(text);

        expect(parsed.syntax.header.cells.map((cell) => cellContent(text, parsed.from, cell))).toEqual(expectedCells);
    });

    it('represents pipe-free body lines as one-cell rows', () => {
        const text = ['| A | B |', '| --- | --- |', 'plain', '| C | D |', 'another'].join('\n');
        const parsed = parse(text);

        expect(parsed.syntax.bodyRows.map((row) => row.cells.length)).toEqual([1, 2, 1]);
        expect(cellContent(text, parsed.from, parsed.syntax.bodyRows[0].cells[0])).toBe('plain');
        expect(cellContent(text, parsed.from, parsed.syntax.bodyRows[2].cells[0])).toBe('another');
    });

    it.each([
        ['a body row', ['| A | B |', '| --- | --- |', '| C | D |   '].join('\n')],
        ['a header row', ['| A | B |  ', '| --- | --- |', '| C | D |'].join('\n')],
        ['a body row ending in a tab', ['| A | B |', '| --- | --- |', '| C | D |\t'].join('\n')],
    ])('ignores trailing padding on %s', (_label, text) => {
        const parsed = parse(text);

        expect(parsed.syntax.header.cells).toHaveLength(2);
        expect(parsed.syntax.bodyRows[0].cells.map((cell) => cellContent(text, parsed.from, cell))).toEqual(['C', 'D']);
    });

    it('trims trailing padding on a pipe-free row', () => {
        const text = ['| A | B |', '| --- | --- |', 'plain   '].join('\n');
        const parsed = parse(text);

        expect(parsed.syntax.bodyRows[0].cells).toHaveLength(1);
        expect(cellContent(text, parsed.from, parsed.syntax.bodyRows[0].cells[0])).toBe('plain');
    });

    it.each([
        ['a space', String.raw`\ `],
        ['a tab', '\\' + '\t'],
    ])('preserves trailing %s that Lezer includes in cell content', (_label, suffix) => {
        const finalCell = `value${suffix}`;
        const text = [`a | ${finalCell}`, '--- | ---', `b | ${finalCell}`].join('\n');
        const parsed = parse(text);

        expect(cellContent(text, parsed.from, parsed.syntax.header.cells[1])).toBe(finalCell);
        expect(cellContent(text, parsed.from, parsed.syntax.bodyRows[0].cells[1])).toBe(finalCell);
    });

    it('allows outer whitespace and reports the table source range', () => {
        const table = ['| A |', '| --- |'].join('\n');
        const text = `\n  \n${table}\n\t`;
        const parsed = parse(text);

        expect(text.slice(parsed.from, parsed.to)).toBe(table);
        expect(parsed.syntax.header.from).toBe(0);
    });

    it.each([
        ['a blockquote table', ['> | A |', '> | --- |'].join('\n')],
        ['a list table', ['- | A |', '  | --- |'].join('\n')],
        ['an invalid separator', ['| A | B |', '| -:- | --- |'].join('\n')],
        ['mismatched header and separator columns', ['| A | B |', '| --- |'].join('\n')],
        ['a separate leading paragraph', ['intro', '', '| A |', '| --- |'].join('\n')],
        ['a separate trailing paragraph', ['| A |', '| --- |', '', 'after'].join('\n')],
        ['multiple tables', ['| A |', '| --- |', '', '| B |', '| --- |'].join('\n')],
    ])('rejects %s', (_label, text) => {
        expect(parseRootMarkdownTableSyntax(text)).toBeNull();
    });
});

import { describe, expect, it } from 'vitest';
import { MarkdownTable } from '../tableModel/MarkdownTable';
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
    it.each([
        ['rows with outer pipes', ['| A | B |', '| --- | --- |', '| C | D |'].join('\n')],
        ['rows without outer pipes', ['A | B', '---|---', 'C | D'].join('\n')],
    ])('extracts table-relative syntax for %s', (_label, text) => {
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

    it.each([
        ['plain text', String.raw`A\|B`],
        ['inline code', '`grep \\| sort`'],
    ])('keeps escaped pipes inside a cell containing %s', (_label, content) => {
        const text = [`| ${content} | C |`, '| --- | --- |'].join('\n');
        const parsed = parse(text);

        expect(parsed.syntax.header.cells.map((cell) => cellContent(text, parsed.from, cell))).toEqual([content, 'C']);
    });

    it('keeps uneven body rows at their source width', () => {
        const text = ['| A | B |', '| --- | --- |', '| C |'].join('\n');
        const parsed = parse(text);

        expect(parsed.syntax.header.cells).toHaveLength(2);
        expect(parsed.syntax.bodyRows[0].cells.map((cell) => cellContent(text, parsed.from, cell))).toEqual(['C']);
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
    ])('trims the trailing %s Lezer pulls in after a backslash', (_label, suffix) => {
        // An odd trailing backslash makes Lezer widen TableCell over the following pad.
        // That pad is layout: keeping it would grow the cell on every serialization round
        // trip and surface the pad character inside the cell editor.
        const text = [`a | value${suffix}`, '--- | ---', `b | value${suffix}`].join('\n');
        const parsed = parse(text);

        expect(cellContent(text, parsed.from, parsed.syntax.header.cells[1])).toBe('value\\');
        expect(cellContent(text, parsed.from, parsed.syntax.bodyRows[0].cells[1])).toBe('value\\');
    });

    it('keeps a cell ending in a backslash stable across serialization', () => {
        // Treating Lezer's pad as content grew the cell by a space on first entry, which then
        // showed up inside the cell editor. Canonical source must be a fixed point instead.
        const text = ['| abc\\ | next |', '| --- | --- |', '| x | y |'].join('\n');
        const table = MarkdownTable.parse(text);

        expect(table?.headerCells[0]).toBe('abc\\');
        expect(table?.serialize()).toBe(text);
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

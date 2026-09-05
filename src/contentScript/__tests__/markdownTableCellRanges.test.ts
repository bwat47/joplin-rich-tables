import { describe, expect, it } from 'vitest';
import { findCellForPos } from '../tableModel/markdownTableCellRanges';
import { parseCellRangesFixture } from './testUtils';

describe('computeMarkdownTableCellRangesFromSyntax', () => {
    it('rebases semantic, editable, and empty-cell bounds past leading whitespace', () => {
        const prefix = '\n \n';
        const headerLine = '|  head  |  |';
        const text = prefix + [headerLine, '| --- | --- |', '|  body  |  |'].join('\n');
        const ranges = parseCellRangesFixture(text);
        const headerFrom = text.indexOf('head');
        const bodyFrom = text.indexOf('body');
        const emptyHeaderFrom = prefix.length + headerLine.indexOf('|  |') + '| '.length;
        const emptyBodyFrom = text.lastIndexOf('|  |') + '| '.length;

        expect(ranges).toEqual({
            headers: [
                {
                    from: headerFrom,
                    to: headerFrom + 'head'.length,
                    editableFrom: headerFrom - 1,
                    editableTo: headerFrom + 'head '.length,
                },
                {
                    from: emptyHeaderFrom,
                    to: emptyHeaderFrom,
                    editableFrom: emptyHeaderFrom,
                    editableTo: emptyHeaderFrom,
                },
            ],
            rows: [
                [
                    {
                        from: bodyFrom,
                        to: bodyFrom + 'body'.length,
                        editableFrom: bodyFrom - 1,
                        editableTo: bodyFrom + 'body '.length,
                    },
                    {
                        from: emptyBodyFrom,
                        to: emptyBodyFrom,
                        editableFrom: emptyBodyFrom,
                        editableTo: emptyBodyFrom,
                    },
                ],
            ],
        });
        expect(findCellForPos(ranges, emptyHeaderFrom)).toEqual({ section: 'header', row: 0, col: 1 });
        expect(findCellForPos(ranges, emptyBodyFrom)).toEqual({ section: 'body', row: 0, col: 1 });
    });

    it('uses an interior insertion point for whitespace-only cells', () => {
        const headerLine = '|   |';
        const text = [headerLine, '| --- |', '|   |'].join('\n');
        const ranges = parseCellRangesFixture(text);

        expect(ranges.headers).toHaveLength(1);
        const r = ranges.headers[0];

        // Range should be zero-width, and not collapsed onto either pipe boundary.
        expect(r.from).toBe(r.to);
        expect(r.from).toBeGreaterThan(1);
        expect(r.from).toBeLessThan(headerLine.length - 1);
        expect(text.slice(r.from, r.to)).toBe('');
    });

    it.each([
        { case: 'hides canonical delimiter padding', headerLine: '| foo |', editable: 'foo' },
        { case: 'preserves user-entered trailing whitespace', headerLine: '| foo  |', editable: 'foo ' },
        { case: 'preserves user-entered leading whitespace', headerLine: '|  foo |', editable: ' foo' },
        {
            case: 'preserves user-entered leading and trailing whitespace',
            headerLine: '|  foo  |',
            editable: ' foo ',
        },
    ])('$case in editable bounds', ({ headerLine, editable }) => {
        const text = [headerLine, '| --- |'].join('\n');
        const ranges = parseCellRangesFixture(text);

        const header = ranges.headers[0];
        expect(text.slice(header.from, header.to)).toBe('foo');
        expect(text.slice(header.editableFrom, header.editableTo)).toBe(editable);
    });

    it('uses a zero-width editable span for canonical empty cells', () => {
        const text = ['|  |', '| --- |'].join('\n');
        const ranges = parseCellRangesFixture(text);

        const header = ranges.headers[0];
        expect(header.editableFrom).toBe(header.editableTo);
        expect(text.slice(header.editableFrom, header.editableTo)).toBe('');
    });

    it('uses a zero-width editable span for a body row containing only one pipe', () => {
        const text = ['| a | b |', '| --- | --- |', '|'].join('\n');
        const ranges = parseCellRangesFixture(text);

        expect(ranges.rows).toEqual([
            [{ from: text.length, to: text.length, editableFrom: text.length, editableTo: text.length }],
        ]);
        expect(findCellForPos(ranges, text.length)).toEqual({ section: 'body', row: 0, col: 0 });
    });

    it('returns stable editable bounds for cells without canonical pad spaces', () => {
        const text = ['|foo|bar|', '|---|---|'].join('\n');
        const ranges = parseCellRangesFixture(text);

        expect(text.slice(ranges.headers[0].editableFrom, ranges.headers[0].editableTo)).toBe('foo');
        expect(text.slice(ranges.headers[1].editableFrom, ranges.headers[1].editableTo)).toBe('bar');
    });

    it('represents an adjacent leading empty cell without consuming its delimiter', () => {
        const text = ['||bar|', '|---|---|'].join('\n');
        const ranges = parseCellRangesFixture(text);

        expect(ranges.headers).toHaveLength(2);
        expect(ranges.headers[0]).toEqual({ from: 1, to: 1, editableFrom: 1, editableTo: 1 });
        expect(findCellForPos(ranges, 1)).toEqual({ section: 'header', row: 0, col: 0 });
        expect(text.slice(ranges.headers[1].editableFrom, ranges.headers[1].editableTo)).toBe('bar');
    });

    it('preserves non-ASCII whitespace that Lezer treats as cell content', () => {
        const nonBreakingSpace = '\u00a0';
        const text = [`|${nonBreakingSpace}|`, '|---|'].join('\n');
        const ranges = parseCellRangesFixture(text);

        expect(text.slice(ranges.headers[0].from, ranges.headers[0].to)).toBe(nonBreakingSpace);
        expect(text.slice(ranges.headers[0].editableFrom, ranges.headers[0].editableTo)).toBe(nonBreakingSpace);
    });

    it.each([
        ['space', String.raw`\ `],
        ['tab', '\\' + '\t'],
    ])('keeps a delimiter-adjacent %s out of both content and edits', (_label, suffix) => {
        const text = [`| a | value${suffix}|`, '| --- | --- |'].join('\n');
        const ranges = parseCellRangesFixture(text);

        const range = ranges.headers[1];
        // Semantic and editable bounds agree, and the reserved pad still separates the
        // cell from its closing pipe so an edit at the end cannot escape the delimiter.
        expect(text.slice(range.from, range.to)).toBe('value\\');
        expect(text.slice(range.editableFrom, range.editableTo)).toBe('value\\');
        expect(text.slice(range.editableTo, range.editableTo + 2)).toBe(`${suffix.slice(-1)}|`);
    });
});

describe('findCellForPos', () => {
    it('finds header cells by position', () => {
        const text = ['| Header A | Header B |', '| --- | --- |', '| Row 1A | Row 1B |'].join('\n');
        const ranges = parseCellRangesFixture(text);

        // Position in first header cell
        const coords1 = findCellForPos(ranges, ranges.headers[0].from);
        expect(coords1).toEqual({ section: 'header', row: 0, col: 0 });

        // Position in second header cell
        const coords2 = findCellForPos(ranges, ranges.headers[1].from);
        expect(coords2).toEqual({ section: 'header', row: 0, col: 1 });
    });

    it('finds body cells by position', () => {
        const text = ['| Header A | Header B |', '| --- | --- |', '| Row 1A | Row 1B |', '| Row 2A | Row 2B |'].join(
            '\n'
        );
        const ranges = parseCellRangesFixture(text);

        // Position in first row, first cell
        const coords1 = findCellForPos(ranges, ranges.rows[0][0].from);
        expect(coords1).toEqual({ section: 'body', row: 0, col: 0 });

        // Position in second row, second cell
        const coords2 = findCellForPos(ranges, ranges.rows[1][1].from);
        expect(coords2).toEqual({ section: 'body', row: 1, col: 1 });
    });

    it('handles positions at cell boundaries', () => {
        const text = ['| abc | def |', '| --- | --- |', '| ghi | jkl |'].join('\n');
        const ranges = parseCellRangesFixture(text);

        const headerCell = ranges.headers[0];

        // Position at start of cell (inclusive)
        const coordsStart = findCellForPos(ranges, headerCell.from);
        expect(coordsStart).toEqual({ section: 'header', row: 0, col: 0 });

        // Position at end of cell (inclusive)
        const coordsEnd = findCellForPos(ranges, headerCell.to);
        expect(coordsEnd).toEqual({ section: 'header', row: 0, col: 0 });

        // Position in middle of cell
        const coordsMiddle = findCellForPos(ranges, headerCell.from + 1);
        expect(coordsMiddle).toEqual({ section: 'header', row: 0, col: 0 });
    });

    it('finds cells for positions in editable edge whitespace but not structural pad space', () => {
        const text = ['|  foo  |', '| --- |'].join('\n');
        const ranges = parseCellRangesFixture(text);

        const headerCell = ranges.headers[0];

        expect(findCellForPos(ranges, headerCell.editableFrom)).toEqual({ section: 'header', row: 0, col: 0 });
        expect(findCellForPos(ranges, headerCell.editableTo)).toEqual({ section: 'header', row: 0, col: 0 });
        expect(findCellForPos(ranges, headerCell.editableFrom - 1)).toBeNull();
    });

    it('returns null for positions outside any cell', () => {
        const text = ['| Header |', '| --- |', '| Body |'].join('\n');
        const ranges = parseCellRangesFixture(text);

        // Position before first cell
        const coords1 = findCellForPos(ranges, 0);
        expect(coords1).toBeNull();

        // Position in separator row (between header and first body row)
        const separatorPos = text.indexOf('---');
        const coords2 = findCellForPos(ranges, separatorPos);
        expect(coords2).toBeNull();

        // Position after last cell
        const coords3 = findCellForPos(ranges, text.length);
        expect(coords3).toBeNull();
    });

    it('handles empty cells', () => {
        const text = ['|   |', '| --- |', '| content |'].join('\n');
        const ranges = parseCellRangesFixture(text);

        // Empty header cell has a zero-width range
        const emptyCell = ranges.headers[0];
        expect(emptyCell.from).toBe(emptyCell.to);

        // Position at the insertion point should find the cell
        const coords = findCellForPos(ranges, emptyCell.from);
        expect(coords).toEqual({ section: 'header', row: 0, col: 0 });
    });

    it('distinguishes between multiple rows', () => {
        const text = ['| H1 | H2 |', '| --- | --- |', '| R1C1 | R1C2 |', '| R2C1 | R2C2 |', '| R3C1 | R3C2 |'].join(
            '\n'
        );
        const ranges = parseCellRangesFixture(text);

        expect(ranges.rows).toHaveLength(3);

        // Check each row's first cell
        const row0Coords = findCellForPos(ranges, ranges.rows[0][0].from);
        expect(row0Coords).toEqual({ section: 'body', row: 0, col: 0 });

        const row1Coords = findCellForPos(ranges, ranges.rows[1][0].from);
        expect(row1Coords).toEqual({ section: 'body', row: 1, col: 0 });

        const row2Coords = findCellForPos(ranges, ranges.rows[2][0].from);
        expect(row2Coords).toEqual({ section: 'body', row: 2, col: 0 });
    });
});

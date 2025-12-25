import { describe, expect, it } from '@jest/globals';
import { computeMarkdownTableCellRanges, findCellForPos } from '../tableModel/markdownTableCellRanges';

function sliceRange(text: string, from: number, to: number): string {
    return text.slice(from, to);
}

describe('computeMarkdownTableCellRanges', () => {
    it('maps basic header/body cells and trims whitespace', () => {
        const text = ['| a |  b  |', '| --- | --- |', '| c | d |'].join('\n');
        const ranges = computeMarkdownTableCellRanges(text);
        expect(ranges).not.toBeNull();
        if (!ranges) return;

        expect(ranges.headers).toHaveLength(2);
        expect(sliceRange(text, ranges.headers[0].from, ranges.headers[0].to)).toBe('a');
        expect(sliceRange(text, ranges.headers[1].from, ranges.headers[1].to)).toBe('b');

        expect(ranges.rows).toHaveLength(1);
        expect(ranges.rows[0]).toHaveLength(2);
        expect(sliceRange(text, ranges.rows[0][0].from, ranges.rows[0][0].to)).toBe('c');
        expect(sliceRange(text, ranges.rows[0][1].from, ranges.rows[0][1].to)).toBe('d');
    });

    it('handles tables without leading/trailing pipes', () => {
        const text = ['a | b', '---|---', 'c | d'].join('\n');
        const ranges = computeMarkdownTableCellRanges(text);
        expect(ranges).not.toBeNull();
        if (!ranges) return;

        expect(ranges.headers).toHaveLength(2);
        expect(sliceRange(text, ranges.headers[0].from, ranges.headers[0].to)).toBe('a');
        expect(sliceRange(text, ranges.headers[1].from, ranges.headers[1].to)).toBe('b');

        expect(ranges.rows).toHaveLength(1);
        expect(ranges.rows[0]).toHaveLength(2);
        expect(sliceRange(text, ranges.rows[0][0].from, ranges.rows[0][0].to)).toBe('c');
        expect(sliceRange(text, ranges.rows[0][1].from, ranges.rows[0][1].to)).toBe('d');
    });

    it('does not treat escaped pipes (\\|) as delimiters', () => {
        const text = ['| a\\|b | c |', '| --- | --- |', '| d | e |'].join('\n');
        const ranges = computeMarkdownTableCellRanges(text);
        expect(ranges).not.toBeNull();
        if (!ranges) return;

        expect(ranges.headers).toHaveLength(2);
        expect(sliceRange(text, ranges.headers[0].from, ranges.headers[0].to)).toBe('a\\|b');
        expect(sliceRange(text, ranges.headers[1].from, ranges.headers[1].to)).toBe('c');
    });

    it('uses an interior insertion point for whitespace-only cells', () => {
        const headerLine = '|   |';
        const text = [headerLine, '| --- |', '|   |'].join('\n');
        const ranges = computeMarkdownTableCellRanges(text);
        expect(ranges).not.toBeNull();
        if (!ranges) return;

        expect(ranges.headers).toHaveLength(1);
        const r = ranges.headers[0];

        // Range should be zero-width, and not collapsed onto either pipe boundary.
        expect(r.from).toBe(r.to);
        expect(r.from).toBeGreaterThan(1);
        expect(r.from).toBeLessThan(headerLine.length - 1);
        expect(sliceRange(text, r.from, r.to)).toBe('');
    });

    it('allows uneven row lengths', () => {
        const text = ['| a | b |', '| --- | --- |', '| c |'].join('\n');
        const ranges = computeMarkdownTableCellRanges(text);
        expect(ranges).not.toBeNull();
        if (!ranges) return;

        expect(ranges.headers).toHaveLength(2);
        expect(ranges.rows).toHaveLength(1);
        expect(ranges.rows[0]).toHaveLength(1);
        expect(sliceRange(text, ranges.rows[0][0].from, ranges.rows[0][0].to)).toBe('c');
    });

    it('ignores pipes inside inline code spans', () => {
        const text = ['| `grep | sort` | Value |', '| --- | --- |'].join('\n');
        const ranges = computeMarkdownTableCellRanges(text);
        expect(ranges).not.toBeNull();
        if (!ranges) return;

        expect(ranges.headers).toHaveLength(2);
        expect(sliceRange(text, ranges.headers[0].from, ranges.headers[0].to)).toBe('`grep | sort`');
        expect(sliceRange(text, ranges.headers[1].from, ranges.headers[1].to)).toBe('Value');
    });
});

describe('findCellForPos', () => {
    it('finds header cells by position', () => {
        const text = ['| Header A | Header B |', '| --- | --- |', '| Row 1A | Row 1B |'].join('\n');
        const ranges = computeMarkdownTableCellRanges(text);
        expect(ranges).not.toBeNull();
        if (!ranges) return;

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
        const ranges = computeMarkdownTableCellRanges(text);
        expect(ranges).not.toBeNull();
        if (!ranges) return;

        // Position in first row, first cell
        const coords1 = findCellForPos(ranges, ranges.rows[0][0].from);
        expect(coords1).toEqual({ section: 'body', row: 0, col: 0 });

        // Position in second row, second cell
        const coords2 = findCellForPos(ranges, ranges.rows[1][1].from);
        expect(coords2).toEqual({ section: 'body', row: 1, col: 1 });
    });

    it('handles positions at cell boundaries', () => {
        const text = ['| abc | def |', '| --- | --- |', '| ghi | jkl |'].join('\n');
        const ranges = computeMarkdownTableCellRanges(text);
        expect(ranges).not.toBeNull();
        if (!ranges) return;

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

    it('returns null for positions outside any cell', () => {
        const text = ['| Header |', '| --- |', '| Body |'].join('\n');
        const ranges = computeMarkdownTableCellRanges(text);
        expect(ranges).not.toBeNull();
        if (!ranges) return;

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
        const ranges = computeMarkdownTableCellRanges(text);
        expect(ranges).not.toBeNull();
        if (!ranges) return;

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
        const ranges = computeMarkdownTableCellRanges(text);
        expect(ranges).not.toBeNull();
        if (!ranges) return;

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

import { describe, expect, it } from '@jest/globals';
import { computeMarkdownTableCellRanges } from '../tableModel/markdownTableCellRanges';

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

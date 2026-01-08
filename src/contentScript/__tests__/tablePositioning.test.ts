import { describe, expect, it } from '@jest/globals';
import { trimTrailingNonTableLines } from '../tableWidget/tablePositioning';

describe('trimTrailingNonTableLines', () => {
    it('returns unchanged text for valid table without trailing content', () => {
        const text = ['| a | b |', '| --- | --- |', '| c | d |'].join('\n');
        expect(trimTrailingNonTableLines(text)).toBe(text);
    });

    it('trims single trailing non-table line', () => {
        const table = ['| a | b |', '| --- | --- |', '| c | d |'].join('\n');
        const input = table + '\ntext-below-table';
        expect(trimTrailingNonTableLines(input)).toBe(table);
    });

    it('trims multiple trailing non-table lines', () => {
        const table = ['| a | b |', '| --- | --- |', '| c | d |'].join('\n');
        const input = table + '\nline1\nline2\nline3';
        expect(trimTrailingNonTableLines(input)).toBe(table);
    });

    it('preserves rows that contain pipe characters', () => {
        const text = ['| a | b |', '| --- | --- |', '| c | d |', 'text | with pipe'].join('\n');
        // Line with pipe is kept (Lezer sees it as a table row)
        expect(trimTrailingNonTableLines(text)).toBe(text);
    });

    it('handles minimal table (header + separator only)', () => {
        const table = ['| a |', '| --- |'].join('\n');
        const input = table + '\ntrailing';
        expect(trimTrailingNonTableLines(input)).toBe(table);
    });

    it('does not trim below minimum table structure', () => {
        // Even if header lacks pipe, we keep 2 lines minimum
        const text = ['| a |', '| --- |'].join('\n');
        expect(trimTrailingNonTableLines(text)).toBe(text);
    });

    it('handles table with multiple body rows and trailing content', () => {
        const table = ['| h1 | h2 |', '| --- | --- |', '| r1c1 | r1c2 |', '| r2c1 | r2c2 |'].join('\n');
        const input = table + '\nsome trailing text';
        expect(trimTrailingNonTableLines(input)).toBe(table);
    });
});

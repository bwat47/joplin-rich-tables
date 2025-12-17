import { describe, expect, it } from '@jest/globals';
import { scanMarkdownTableRow } from '../tableModel/markdownTableRowScanner';

describe('scanMarkdownTableRow', () => {
    it('finds all pipe delimiters in a simple row', () => {
        const line = '| a | b | c |';
        const { delimiters } = scanMarkdownTableRow(line);
        expect(delimiters).toEqual([0, 4, 8, 12]);
    });

    it('ignores escaped pipes', () => {
        // String is: | a\|b | c |
        // Positions:  0123456789...
        const line = '| a\\|b | c |';
        const { delimiters } = scanMarkdownTableRow(line);
        expect(delimiters).toEqual([0, 7, 11]);
    });

    it('ignores pipes inside inline code spans', () => {
        const line = '| `grep | sort` | Value |';
        const { delimiters } = scanMarkdownTableRow(line);
        expect(delimiters).toHaveLength(3);
        expect(delimiters).toEqual([0, 16, 24]);
    });

    it('treats unclosed backtick as literal character', () => {
        const line = '| `unclosed | Next |';
        const { delimiters } = scanMarkdownTableRow(line);
        expect(delimiters).toHaveLength(3);
        expect(delimiters).toEqual([0, 12, 19]);
    });

    it('handles escaped backticks correctly', () => {
        const line = '| \\`not code | Next |';
        const { delimiters } = scanMarkdownTableRow(line);
        expect(delimiters).toHaveLength(3);
        expect(delimiters).toEqual([0, 13, 20]);
    });

    it('handles code span immediately adjacent to pipe', () => {
        const line = '|`code`| Next |';
        const { delimiters } = scanMarkdownTableRow(line);
        expect(delimiters).toHaveLength(3);
        expect(delimiters).toEqual([0, 7, 14]);
    });

    it('handles multiple code spans in one row', () => {
        const line = '| `a|b` | `c|d` |';
        const { delimiters } = scanMarkdownTableRow(line);
        expect(delimiters).toHaveLength(3);
        expect(delimiters).toEqual([0, 8, 16]);
    });

    it('handles empty code spans', () => {
        const line = '| `` | Value |';
        const { delimiters } = scanMarkdownTableRow(line);
        expect(delimiters).toHaveLength(3);
    });

    it('handles escaped backslash before pipe', () => {
        // \\| means escaped backslash followed by unescaped pipe
        const line = '| a\\\\| b |';
        const { delimiters } = scanMarkdownTableRow(line);
        expect(delimiters).toEqual([0, 5, 9]);
    });

    it('returns empty array for line with no pipes', () => {
        const line = 'no pipes here';
        const { delimiters } = scanMarkdownTableRow(line);
        expect(delimiters).toEqual([]);
    });
});

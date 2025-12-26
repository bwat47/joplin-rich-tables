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

    it('treats backticks as regular characters (no special handling)', () => {
        // Pipes inside backticks are treated as delimiters unless escaped.
        // The transaction filter escapes pipes, so this is GFM-compliant.
        // | `a | b` | c |
        // 0    5    10  14
        const line = '| `a | b` | c |';
        const { delimiters } = scanMarkdownTableRow(line);
        // All unescaped pipes are delimiters
        expect(delimiters).toEqual([0, 5, 10, 14]);
    });

    it('handles escaped pipe inside backticks', () => {
        // Properly escaped: | `a \| b` | c |
        const line = '| `a \\| b` | c |';
        const { delimiters } = scanMarkdownTableRow(line);
        // The escaped pipe is not a delimiter
        expect(delimiters).toEqual([0, 11, 15]);
    });
});

import { describe, expect, it } from 'vitest';
import {
    convertNewlinesToBr,
    escapeUnescapedPipes,
    normalizeBrTags,
    rootToLocalOffsets,
    sanitizeLocalText,
    unsanitizeRootText,
} from '../shared/cellTextNormalization';

describe('escapeUnescapedPipes', () => {
    it('escapes unescaped pipes', () => {
        expect(escapeUnescapedPipes('a|b')).toBe(String.raw`a\|b`);
        expect(escapeUnescapedPipes('|')).toBe(String.raw`\|`);
        expect(escapeUnescapedPipes('a|b|c')).toBe(String.raw`a\|b\|c`);
    });

    it('keeps already-escaped pipes intact', () => {
        expect(escapeUnescapedPipes(String.raw`a\|b`)).toBe(String.raw`a\|b`);
    });

    it('escapes pipes after even backslash runs and preserves them after odd runs', () => {
        expect(escapeUnescapedPipes(String.raw`a\\|b`)).toBe(String.raw`a\\\|b`);
        expect(escapeUnescapedPipes(String.raw`a\\\|b`)).toBe(String.raw`a\\\|b`);
    });
});

describe('convertNewlinesToBr', () => {
    it('converts LF, CRLF, and CR to <br>', () => {
        expect(convertNewlinesToBr('a\nb')).toBe('a<br>b');
        expect(convertNewlinesToBr('a\r\nb')).toBe('a<br>b');
        expect(convertNewlinesToBr('a\rb')).toBe('a<br>b');
    });
});

describe('normalizeBrTags', () => {
    it('canonicalizes self-closing br tags to <br>', () => {
        expect(normalizeBrTags('a<br/>b')).toBe('a<br>b');
        expect(normalizeBrTags('a<br />b')).toBe('a<br>b');
        expect(normalizeBrTags('a<BR/>b')).toBe('a<br>b');
    });
});

describe('sanitizeLocalText / unsanitizeRootText', () => {
    it('converts local newlines and pipes to markdown-safe cell text', () => {
        expect(sanitizeLocalText('a\nb|c')).toBe(String.raw`a<br>b\|c`);
    });

    it('normalizes self-closing br tags before syncing to root text', () => {
        expect(sanitizeLocalText('a<br/>b|c')).toBe(String.raw`a<br>b\|c`);
        expect(sanitizeLocalText('a<br />b|c')).toBe(String.raw`a<br>b\|c`);
    });

    it('preserves trailing spaces during live editing sync', () => {
        expect(sanitizeLocalText('sometext ')).toBe('sometext ');
    });

    it('converts root markdown-safe cell text back to local display text', () => {
        expect(unsanitizeRootText(String.raw`a<br>b\|c`)).toBe('a\nb|c');
    });

    it('escapes a backslash run down to the pipe it ends with', () => {
        // The two spellings the offset map has to agree with `unsanitizeRootText` about.
        expect(unsanitizeRootText(String.raw`a\\|b`)).toBe(String.raw`a\|b`);
    });
});

describe('rootToLocalOffsets', () => {
    /** The offsets a plain scan of `rootText` would need, character by character. */
    const displayOffsets = (rootText: string): number[] => Array.from(rootToLocalOffsets(rootText));

    it('maps the only offset in an empty cell to zero', () => {
        expect(displayOffsets('')).toEqual([0]);
    });

    it('maps consecutive substitutions through the end of the cell', () => {
        expect(displayOffsets(String.raw`<br>\|<br>`)).toEqual([0, 0, 0, 0, 1, 1, 2, 2, 2, 2, 3]);
    });

    it.each([
        { root: String.raw`a\\|b`, offsets: [0, 1, 2, 2, 3, 4] },
        { root: String.raw`a\\\|b`, offsets: [0, 1, 2, 3, 3, 4, 5] },
    ])('preserves backslashes before the final pipe escape in $root', ({ root, offsets }) => {
        expect(displayOffsets(root)).toEqual(offsets);
    });

    it('counts emoji as UTF-16 code units on both sides of a substitution', () => {
        expect(displayOffsets('😀<br>😀')).toEqual([0, 1, 2, 2, 2, 2, 3, 4, 5]);
    });

    it('maps stored text one to one where nothing is spelled out', () => {
        expect(displayOffsets('abc')).toEqual([0, 1, 2, 3]);
    });

    it('lands every offset in the same place the display text puts it', () => {
        const rootText = String.raw`a<br>b\|c`;

        // `a\nb|c`: the offsets after each stored spelling shift by what it saves.
        expect(displayOffsets(rootText)).toEqual([0, 1, 1, 1, 1, 2, 3, 3, 4, 5]);
        expect(unsanitizeRootText(rootText)).toHaveLength(5);
    });

    it('gives the start of what a spelling displays as for offsets inside it', () => {
        // The middle of `<br>` has nowhere else to be: it is one newline in the nested editor.
        const offsets = rootToLocalOffsets('<br>x');

        expect(offsets[1]).toBe(0);
        expect(offsets[3]).toBe(0);
        expect(offsets[4]).toBe(1);
    });

    it('ends one past the display text, so a range can reach the end of the cell', () => {
        const rootText = String.raw`a<br>b`;

        expect(rootToLocalOffsets(rootText)[rootText.length]).toBe(unsanitizeRootText(rootText).length);
    });
});

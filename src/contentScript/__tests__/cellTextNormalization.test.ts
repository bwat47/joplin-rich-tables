import { describe, expect, it } from 'vitest';
import {
    convertNewlinesToBr,
    escapeUnescapedPipesWithContext,
    localToRootOffsets,
    normalizeBrTags,
    rootToLocalOffsets,
    sanitizeLocalText,
    unsanitizeRootText,
} from '../shared/cellTextNormalization';

describe('escapeUnescapedPipesWithContext', () => {
    const escapePipes = (text: string): string => escapeUnescapedPipesWithContext(text, 0);

    it('escapes unescaped pipes', () => {
        expect(escapePipes('a|b')).toBe(String.raw`a\|b`);
        expect(escapePipes('|')).toBe(String.raw`\|`);
        expect(escapePipes('a|b|c')).toBe(String.raw`a\|b\|c`);
    });

    it('keeps already-escaped pipes intact', () => {
        expect(escapePipes(String.raw`a\|b`)).toBe(String.raw`a\|b`);
    });

    it('escapes pipes after even backslash runs and preserves them after odd runs', () => {
        expect(escapePipes(String.raw`a\\|b`)).toBe(String.raw`a\\\|b`);
        expect(escapePipes(String.raw`a\\\|b`)).toBe(String.raw`a\\\|b`);
    });

    it('counts a backslash run the text is preceded by', () => {
        expect(escapeUnescapedPipesWithContext('|', 1)).toBe('|');
        expect(escapeUnescapedPipesWithContext('|', 2)).toBe(String.raw`\|`);
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

    it.each([
        { root: 'a<br', offsets: [0, 1, 2, 3, 4] },
        { root: 'a\\', offsets: [0, 1, 2] },
    ])('leaves a spelling the cell breaks off partway through as text in $root', ({ root, offsets }) => {
        expect(displayOffsets(root)).toEqual(offsets);
        expect(unsanitizeRootText(root)).toBe(root);
    });

    it('matches a stored spelling exactly, so an uppercase break tag stays text', () => {
        expect(displayOffsets('a<BR>b')).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(unsanitizeRootText('a<BR>b')).toBe('a<BR>b');
    });
});

describe('localToRootOffsets', () => {
    /** The offsets a plain scan of `localText` would need, character by character. */
    const storedOffsets = (localText: string): number[] => Array.from(localToRootOffsets(localText));

    it('maps display text one to one where nothing is spelled out', () => {
        expect(storedOffsets('abc')).toEqual([0, 1, 2, 3]);
    });

    it('lands every offset in the same place the stored text puts it', () => {
        const localText = 'a\nb|c';

        // `a<br>b\|c`: the offsets after each rewrite shift by what it spells out.
        expect(storedOffsets(localText)).toEqual([0, 1, 5, 6, 8, 9]);
        expect(sanitizeLocalText(localText)).toHaveLength(9);
    });

    it('puts a caret before a pipe before the backslash that escapes it', () => {
        // Otherwise the caret would land inside `\|`, where the stored text has no such position.
        expect(storedOffsets('|')).toEqual([0, 2]);
    });

    it('leaves a caret between a backslash and the pipe it already escapes where it is', () => {
        expect(storedOffsets(String.raw`\|`)).toEqual([0, 1, 2]);
    });

    it('gives the start of a rewritten break tag for offsets inside it', () => {
        const offsets = localToRootOffsets('<br/>x');

        expect(offsets[1]).toBe(0);
        expect(offsets[4]).toBe(0);
        expect(offsets[5]).toBe(4);
    });

    it('ends one past the stored text, so a range can reach the end of the cell', () => {
        const localText = 'a\nb';

        expect(localToRootOffsets(localText)[localText.length]).toBe(sanitizeLocalText(localText).length);
    });

    it('maps the only offset in an empty cell to zero', () => {
        expect(storedOffsets('')).toEqual([0]);
    });

    it('treats a CRLF as the one line break it is stored as', () => {
        expect(storedOffsets('a\r\nb')).toEqual([0, 1, 1, 5, 6]);
    });

    it('counts emoji as UTF-16 code units on both sides of a rewrite', () => {
        expect(storedOffsets('\u{1F600}\n\u{1F600}')).toEqual([0, 1, 2, 6, 7, 8]);
    });

    it('agrees with the round trip about where the end of the cell is', () => {
        const localText = 'a\nb|c';
        const rootText = sanitizeLocalText(localText);

        expect(unsanitizeRootText(rootText)).toBe(localText);
        expect(rootToLocalOffsets(rootText)[localToRootOffsets(localText)[3]]).toBe(3);
    });
});

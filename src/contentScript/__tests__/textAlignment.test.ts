import { describe, it, expect } from 'vitest';
import { alignRenderedToSource, mapCaretToSource } from '../shared/textAlignment';

/**
 * Maps a caret in rendered text back to its source offset, expressed as the source split
 * at that point so failures read as text rather than as an integer mismatch.
 */
function place(rendered: string, source: string, caret: number): string {
    const alignment = alignRenderedToSource(rendered, source);
    if (!alignment) {
        throw new Error('expected an alignment');
    }
    const offset = mapCaretToSource(alignment.toSource, caret, source.length);
    return `${source.slice(0, offset)}|${source.slice(offset)}`;
}

function ratio(rendered: string, source: string): number {
    const alignment = alignRenderedToSource(rendered, source);
    if (!alignment) {
        throw new Error('expected an alignment');
    }
    return alignment.matchedRatio;
}

/** Comfortably past `RESYNC_WINDOW`, without this test needing to know its exact value. */
const RESYNC_WINDOW_LIMIT = 60;

describe('alignRenderedToSource', () => {
    it('places a caret inside emphasised text at the matching source character', () => {
        // The reported case: clicking between "w" and "n" of a bolded "markdown".
        expect(place('markdown', '**markdown**', 7)).toBe('**markdow|n**');
    });

    it('maps identical text one-to-one', () => {
        expect(place('plain text', 'plain text', 6)).toBe('plain |text');
    });

    it('maps all repeated text when a later longest block would strand an earlier character', () => {
        expect(place('aaa', 'a**aa**', 1)).toBe('a**|aa**');
        expect(place('aaa', 'a**aa**', 2)).toBe('a**a|a**');
    });

    it('places a caret in link text rather than in the URL', () => {
        // "link" occurs twice in the source; only the label is the text that was rendered.
        expect(place('link', '[link](http://link.com)', 2)).toBe('[li|nk](http://link.com)');
    });

    it('keeps the caret inside inline code', () => {
        expect(place('code', '`code`', 2)).toBe('`co|de`');
    });

    it('still aligns tag-shaped text rendered literally by an inline code span', () => {
        expect(place('<code>code</code>', '`<code>code</code>`', 8)).toBe('`<code>co|de</code>`');
    });

    it('does not mistake an autolink for an HTML tag', () => {
        expect(place('https://example.com', '<https://example.com>', 8)).toBe('<https://|example.com>');
    });

    it('binds a caret at a syntax boundary to the character that follows it', () => {
        // Both sides of the closing `**` are defensible for a caret between "bold" and the
        // space. Ties resolve towards the following character throughout, so the rule is the
        // same at an opening boundary, where it puts the caret inside the emphasis instead.
        expect(place('bold and more', '**bold** and more', 4)).toBe('**bold**| and more');
        expect(place('abc', 'a**b**c', 1)).toBe('a**|b**c');
    });

    it('pins a caret past the last rendered character to the end of the source', () => {
        // Clicking to the right of a short cell means "type here", including past trailing syntax.
        expect(place('bold', '**bold**', 4)).toBe('**bold**|');
    });

    it('pins a caret before the first rendered character to the start of the source', () => {
        expect(place('bold', '**bold**', 0)).toBe('|**bold**');
    });

    it('aligns across several inline constructs', () => {
        const source = 'see **the** `docs` for [more](http://x.y)';
        expect(place('see the docs for more', source, 9)).toBe('see **the** `d|ocs` for [more](http://x.y)');
    });

    it('recovers after a substitution instead of desynchronising', () => {
        // "&" is rendered from "&amp;"; everything after it must still align exactly.
        const source = 'a &amp; bcdef';
        expect(place('a & bcdef', source, 6)).toBe('a &amp; bc|def');
    });

    it('treats a newline from a line break like any other character', () => {
        expect(place('one\ntwo', 'one\ntwo', 5)).toBe('one\nt|wo');
    });

    it('resolves a caret beside an unmatched run to the nearest anchor', () => {
        // The emoji is nowhere in the source, so the shortcode it came from is one gap the
        // caret steps over rather than into. Its two UTF-16 units put "after" at caret 4.
        expect(place('ab\u{1F600}cd', 'ab:smile:cd', 2)).toBe('ab|:smile:cd');
        expect(place('ab\u{1F600}cd', 'ab:smile:cd', 4)).toBe('ab:smile:|cd');
    });

    it('reports full matching when the rendered text is a subsequence of the source', () => {
        expect(ratio('bold', '**bold**')).toBe(1);
    });

    it('reports partial matching when the rendered text diverges from the source', () => {
        expect(ratio('\u{1D465}²', '$x^2$')).toBeLessThan(0.5);
    });

    it('treats empty rendered text as fully matched', () => {
        expect(ratio('', '$x^2$')).toBe(1);
        expect(place('', '$x^2$', 0)).toBe('|$x^2$');
    });

    it('handles a source that shares nothing with the rendered text', () => {
        expect(place('xyz', 'abc', 1)).toBe('|abc');
        expect(ratio('xyz', 'abc')).toBe(0);
    });

    it('declines to align inputs longer than the supported cell size', () => {
        expect(alignRenderedToSource('a'.repeat(1001), 'a'.repeat(1001))).toBeNull();
        expect(alignRenderedToSource('a', 'a'.repeat(1001))).toBeNull();
    });

    it('aligns a long repeated-character cell within the supported size', () => {
        // Every character is a candidate for every other, which the run check resolves in favour
        // of staying in step rather than jumping to a later copy.
        expect(alignRenderedToSource('a'.repeat(1000), 'a'.repeat(1000))?.matchedRatio).toBe(1);
    });

    it('aligns a long prose cell carrying inline markup', () => {
        const rendered = 'lorem ipsum dolor sit amet '.repeat(33);
        const source = rendered.replace(/dolor/g, '**dolor**').slice(0, 1000);

        expect(alignRenderedToSource(rendered, source)?.matchedRatio).toBeGreaterThan(0.9);
    });

    it('aligns text sharing no run longer than a character, one anchor at a time', () => {
        // Nothing longer than one character is common to the two, so no candidate ever starts an
        // agreeing run and every anchor is the nearest bare match.
        expect(alignRenderedToSource('a'.repeat(500), 'ab'.repeat(500))?.matchedRatio).toBe(1);
    });

    it('aligns a cell of short inline code spans rather than declining the click', () => {
        // The same shape from real Markdown: `a` `a` `a` ... rendering to `a a a `.
        expect(place('a a a ', '`a` `a` `a` ', 2)).toBe('`a` `|a` `a` ');
    });

    it('strands the rest of a cell behind a hidden run wider than the resync window', () => {
        // The scan cannot see past the window and never backtracks, so nothing after the run
        // finds an anchor. The collapsed ratio is what keeps the caller from trusting it.
        const hidden = 'y'.repeat(RESYNC_WINDOW_LIMIT);
        const alignment = alignRenderedToSource('abcdefghij' + 'klmnopqrst', `abcdefghij${hidden}klmnopqrst`);

        expect(alignment?.matchedRatio).toBeLessThan(0.6);
    });
});

/**
 * Substitutions a renderer actually makes, as (label, rendered, projected source) with the caret
 * to place and the source split at where it should land.
 *
 * These are the shapes that reach alignment at all: the projection has already removed hidden
 * Markdown, so what is left differs only where rendering rewrote a character. Each was checked
 * against a longest-matching-block alignment of the same input, which places every caret in
 * these cells identically.
 */
const SUBSTITUTION_CASES: ReadonlyArray<
    readonly [label: string, rendered: string, source: string, caret: number, expected: string]
> = [
    ['em dash', 'a — b and more text', 'a --- b and more text', 8, 'a --- b an|d more text'],
    ['ellipsis', 'wait… then go on', 'wait... then go on', 6, 'wait... |then go on'],
    ['smart quotes', '“quoted words” after', '"quoted words" after', 8, '"quoted |words" after'],
    ['apostrophe', 'it’s a test of things', "it's a test of things", 5, "it's |a test of things"],
    ['entity', 'Tom & Jerry go home', 'Tom &amp; Jerry go home', 8, 'Tom &amp; Je|rry go home'],
    ['emoji shortcode', 'nice \u{1F600} work here', 'nice :smile: work here', 9, 'nice :smile: w|ork here'],
    ['repeated token past a substitution', 'cat — cat — cat', 'cat --- cat --- cat', 12, 'cat --- cat --- |cat'],
];

describe('alignRenderedToSource across renderer substitutions', () => {
    it.each(SUBSTITUTION_CASES)('places a caret past a %s', (_label, rendered, source, caret, expected) => {
        expect(place(rendered, source, caret)).toBe(expected);
    });

    it('keeps aligning a long cell whose substitutions repeat throughout', () => {
        const rendered = 'lorem ipsum — dolor sit amet '.repeat(20).slice(0, 600);
        const source = 'lorem ipsum --- dolor sit amet '.repeat(20).slice(0, 640);

        expect(ratio(rendered, source)).toBeGreaterThan(0.95);
    });
});

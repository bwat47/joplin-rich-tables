import { describe, expect, it } from 'vitest';
import { buildRenderableContent, escapeLeadingBlockMarkers, mightContainMarkup } from '../shared/cellContentUtils';

describe('escapeLeadingBlockMarkers', () => {
    it('escapes leading heading markers', () => {
        expect(escapeLeadingBlockMarkers('# Title')).toBe(String.raw`\# Title`);
        expect(escapeLeadingBlockMarkers('   ## Title')).toBe(String.raw`   \## Title`);
    });

    it('escapes leading blockquote markers', () => {
        expect(escapeLeadingBlockMarkers('> Quote')).toBe(String.raw`\> Quote`);
        expect(escapeLeadingBlockMarkers('>Quote')).toBe(String.raw`\>Quote`);
    });

    it('escapes leading unordered list markers', () => {
        expect(escapeLeadingBlockMarkers('- Item')).toBe(String.raw`\- Item`);
        expect(escapeLeadingBlockMarkers('* Item')).toBe(String.raw`\* Item`);
        expect(escapeLeadingBlockMarkers('+ Item')).toBe(String.raw`\+ Item`);
    });

    it('escapes leading ordered list markers', () => {
        expect(escapeLeadingBlockMarkers('1. Item')).toBe(String.raw`1\. Item`);
        expect(escapeLeadingBlockMarkers('12) Item')).toBe(String.raw`12\) Item`);
    });

    it('does not escape inline formatting', () => {
        expect(escapeLeadingBlockMarkers('*italic*')).toBe('*italic*');
        expect(escapeLeadingBlockMarkers('**bold**')).toBe('**bold**');
        expect(escapeLeadingBlockMarkers('_italic_')).toBe('_italic_');
    });

    it('does not escape when cell starts with inline code', () => {
        expect(escapeLeadingBlockMarkers('`# not a heading`')).toBe('`# not a heading`');
        expect(escapeLeadingBlockMarkers('`- not a list`')).toBe('`- not a list`');
    });

    it('does not escape non-heading hashes without space', () => {
        expect(escapeLeadingBlockMarkers('#Title')).toBe('#Title');
    });
});

describe('buildRenderableContent', () => {
    it('keeps fallback display text unescaped while escaping the render cache key', () => {
        const result = buildRenderableContent('# Heading');
        expect(result.displayText).toBe('# Heading');
        expect(result.cacheKey).toBe(String.raw`\# Heading`);
    });

    it('uses the normalized display text as the cache key for reference-looking links', () => {
        const result = buildRenderableContent('[ref]');
        expect(result.displayText).toBe('[ref]');
        expect(result.cacheKey).toBe(result.displayText);
    });

    it('unescapes pipes for display and cache lookup', () => {
        const result = buildRenderableContent(String.raw`a \| b`);
        expect(result.displayText).toBe('a | b');
        expect(result.cacheKey).toBe('a | b');
    });
});

describe('mightContainMarkup', () => {
    it('detects inline markdown syntax', () => {
        expect(mightContainMarkup('**bold**')).toBe(true);
        expect(mightContainMarkup('a `code` span')).toBe(true);
        expect(mightContainMarkup('[link](https://example.com)')).toBe(true);
        expect(mightContainMarkup('~~struck~~')).toBe(true);
    });

    it('detects HTML entities and tags', () => {
        expect(mightContainMarkup('Test &amp; text')).toBe(true);
        expect(mightContainMarkup('Decimal: &#38; hexadecimal: &#x26;')).toBe(true);
        expect(mightContainMarkup('line<br>break')).toBe(true);
    });

    it('detects emoji shortcodes', () => {
        expect(mightContainMarkup(':smile:')).toBe(true);
        expect(mightContainMarkup('Status: :white_check_mark:')).toBe(true);
    });

    it('detects superscript and subscript', () => {
        expect(mightContainMarkup('abc ^sup^ and def ~sub~')).toBe(true);
        expect(mightContainMarkup('H~2~O')).toBe(true);
    });

    it('detects KaTeX inline math', () => {
        expect(mightContainMarkup('$00$')).toBe(true);
        expect(mightContainMarkup('$ZX = Y$')).toBe(true);
    });

    it('detects typographer syntax that no marker list would catch', () => {
        expect(mightContainMarkup('He said "hi"')).toBe(true);
        expect(mightContainMarkup("don't")).toBe(true);
        expect(mightContainMarkup('wait -- what')).toBe(true);
        expect(mightContainMarkup('and so on...')).toBe(true);
    });

    it('treats plain text as inert', () => {
        expect(mightContainMarkup('')).toBe(false);
        expect(mightContainMarkup('Note: plain text')).toBe(false);
        expect(mightContainMarkup('Price is $5')).toBe(false);
        expect(mightContainMarkup('Q3 revenue (EMEA), 42%')).toBe(false);
        expect(mightContainMarkup('Ana Gonzalez-Ruiz')).toBe(false);
        expect(mightContainMarkup('Größe 12 Ünicode')).toBe(false);
    });
});

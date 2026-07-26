import { describe, expect, it } from 'vitest';
import { buildRenderableContent, containsMarkdown, escapeLeadingBlockMarkers } from '../shared/cellContentUtils';

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

describe('containsMarkdown', () => {
    it('detects KaTeX inline math', () => {
        expect(containsMarkdown('$00$')).toBe(true);
        expect(containsMarkdown('$ZX = Y$')).toBe(true);
    });

    it('does not treat a single dollar sign as markdown math', () => {
        expect(containsMarkdown('Price is $5')).toBe(false);
    });
});

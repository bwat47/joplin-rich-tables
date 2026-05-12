import { describe, expect, it } from '@jest/globals';
import { buildRenderableContent, containsMarkdown, escapeLeadingBlockMarkers } from '../shared/cellContentUtils';

describe('escapeLeadingBlockMarkers', () => {
    it('escapes leading heading markers', () => {
        expect(escapeLeadingBlockMarkers('# Title')).toBe('\\# Title');
        expect(escapeLeadingBlockMarkers('   ## Title')).toBe('   \\## Title');
    });

    it('escapes leading blockquote markers', () => {
        expect(escapeLeadingBlockMarkers('> Quote')).toBe('\\> Quote');
        expect(escapeLeadingBlockMarkers('>Quote')).toBe('\\>Quote');
    });

    it('escapes leading unordered list markers', () => {
        expect(escapeLeadingBlockMarkers('- Item')).toBe('\\- Item');
        expect(escapeLeadingBlockMarkers('* Item')).toBe('\\* Item');
        expect(escapeLeadingBlockMarkers('+ Item')).toBe('\\+ Item');
    });

    it('escapes leading ordered list markers', () => {
        expect(escapeLeadingBlockMarkers('1. Item')).toBe('1\\. Item');
        expect(escapeLeadingBlockMarkers('12) Item')).toBe('12\\) Item');
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
    it('escapes leading block markers in displayText', () => {
        const result = buildRenderableContent('# Heading');
        expect(result.displayText).toBe('\\# Heading');
    });

    it('uses the normalized display text as the cache key for reference-looking links', () => {
        const result = buildRenderableContent('[ref]');
        expect(result.displayText).toBe('[ref]');
        expect(result.cacheKey).toBe(result.displayText);
    });

    it('unescapes pipes for display and cache lookup', () => {
        const result = buildRenderableContent('a \\| b');
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

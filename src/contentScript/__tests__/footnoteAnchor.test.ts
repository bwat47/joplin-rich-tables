import { describe, expect, it } from 'vitest';
import { buildFootnoteHref, parseFootnoteHref } from '../shared/footnoteAnchor';

describe('footnote anchor contract', () => {
    it.each(['1', 'abc', 'my note', 'héllo', 'a/b?c#d', '100%'])(
        'round-trips the label %j through an href',
        (label) => {
            expect(parseFootnoteHref(buildFootnoteHref(label))).toBe(label);
        }
    );

    it('percent-encodes characters that are unsafe in an href', () => {
        expect(buildFootnoteHref('my note')).toBe('#fn-my%20note');
    });

    it.each(['#heading', '#fn', '#fn-', '#fnref-1', 'https://example.com', ':/abc123', ''])(
        'returns null for %j, which is not a footnote href',
        (href) => {
            expect(parseFootnoteHref(href)).toBeNull();
        }
    );

    it('falls back to the raw text when a hand-authored href has a malformed escape', () => {
        expect(parseFootnoteHref('#fn-50%off')).toBe('50%off');
    });
});

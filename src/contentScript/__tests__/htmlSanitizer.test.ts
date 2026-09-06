/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';

// The suite aliases `dompurify` to a passthrough double, which cannot answer the question this
// file exists for: the render pipeline now depends on the real library returning nodes rather
// than markup, and on it still stripping what it always stripped.
// The path is relative because the alias rewrites anything starting with the bare specifier.
vi.mock('dompurify', async () => {
    const actual = (await vi.importActual('../../../node_modules/dompurify/dist/purify.cjs.js')) as {
        default: unknown;
    };
    return { default: actual.default ?? actual };
});

import { fragmentHtml } from './testUtils';

const { sanitizeToFragment } = await import('../services/htmlSanitizer');

describe('sanitizeToFragment', () => {
    it('returns nodes rather than markup', () => {
        const fragment = sanitizeToFragment('<p><strong>ok</strong></p>');

        expect(fragment).toBeInstanceOf(DocumentFragment);
        expect(fragmentHtml(fragment)).toBe('<p><strong>ok</strong></p>');
    });

    it('strips scripts and event handlers', () => {
        const fragment = sanitizeToFragment('<script>alert(1)</script><p onclick="steal()">text</p>');

        const result = fragmentHtml(fragment);
        expect(result).not.toContain('script');
        expect(result).not.toContain('onclick');
        expect(result).toContain('text');
    });

    it('keeps the Joplin attributes cells rely on', () => {
        const fragment = sanitizeToFragment('<a data-resource-id="abc" href="joplin-content://x">link</a>');

        const result = fragmentHtml(fragment);
        expect(result).toContain('data-resource-id="abc"');
        expect(result).toContain('joplin-content://x');
    });

    it('drops forms but keeps the text inside them', () => {
        const result = fragmentHtml(sanitizeToFragment('<form action="/steal"><p>text</p></form>'));

        expect(result).not.toContain('<form');
        expect(result).toContain('text');
    });

    it('drops iframes that are not YouTube embeds', () => {
        const allowed = fragmentHtml(
            sanitizeToFragment('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>')
        );
        const blocked = fragmentHtml(sanitizeToFragment('<iframe src="https://evil.example/embed/abc"></iframe>'));

        expect(allowed).toContain('<iframe');
        expect(blocked).not.toContain('<iframe');
    });
});

/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import type { RenderMarkupResult } from '../../contentScriptBridge/contentScriptMessages';
import { createMarkdownRenderer, MAX_CACHE_SIZE, type RenderMarkupFn } from '../services/markdownRenderer';
import { deferred } from './testUtils';

vi.mock('../../logger', () => ({
    logger: {
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    },
}));

describe('createMarkdownRenderer', () => {
    it('sanitizes, post-processes, and caches rendered HTML', async () => {
        const renderMarkup = vi.fn<RenderMarkupFn>(async (_markdown, id) => ({
            id,
            html: '<p><strong>ok</strong><span class="joplin-source">raw</span></p>',
        }));
        const renderer = createMarkdownRenderer(renderMarkup);

        const first = await renderer.render('**ok**');
        const second = await renderer.render('**ok**');

        expect(first).toContain('<strong>ok</strong>');
        expect(first).not.toContain('joplin-source');
        expect(second).toBe(first);
        expect(renderMarkup).toHaveBeenCalledTimes(1);
        expect(renderer.getCached('**ok**')).toBe(first);
    });

    it('de-dupes concurrent identical render requests', async () => {
        const pending = deferred<RenderMarkupResult>();
        const renderMarkup = vi.fn<RenderMarkupFn>(() => pending.promise);
        const renderer = createMarkdownRenderer(renderMarkup);

        const first = renderer.render('`x`');
        const second = renderer.render('`x`');
        pending.resolve({ id: 'render-1', html: '<p><code>x</code></p>' });

        await expect(first).resolves.toContain('<code>x</code>');
        await expect(second).resolves.toContain('<code>x</code>');
        expect(renderMarkup).toHaveBeenCalledTimes(1);
    });

    it('evicts the least recently used entry, not the oldest', async () => {
        const renderMarkup = vi.fn<RenderMarkupFn>(async (markdown, id) => ({
            id,
            html: `<p>${markdown}</p>`,
        }));
        const renderer = createMarkdownRenderer(renderMarkup);

        for (let index = 0; index < MAX_CACHE_SIZE; index++) {
            await renderer.render(`value-${index}`);
        }

        // Read the oldest entry, then overflow the cache by one.
        expect(renderer.getCached('value-0')).toContain('value-0');
        await renderer.render('overflow');

        expect(renderer.getCached('value-0')).toContain('value-0');
        expect(renderer.getCached('value-1')).toBeUndefined();
    });

    it('evicts the oldest cache entry after the cache limit', async () => {
        const renderMarkup = vi.fn<RenderMarkupFn>(async (markdown, id) => ({
            id,
            html: `<p>${markdown}</p>`,
        }));
        const renderer = createMarkdownRenderer(renderMarkup);

        const overflow = MAX_CACHE_SIZE + 1;
        for (let index = 0; index < overflow; index++) {
            await renderer.render(`value-${index}`);
        }

        expect(renderer.getCached('value-0')).toBeUndefined();
        expect(renderer.getCached('value-1')).toContain('value-1');
        expect(renderer.getCached(`value-${overflow - 1}`)).toContain(`value-${overflow - 1}`);
    });

    it('returns escaped fallback HTML when rendering rejects or returns an error', async () => {
        const renderMarkup = vi
            .fn<RenderMarkupFn>()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce({ id: 'render-2', html: '<img src=x onerror=alert(1)>', error: true });
        const renderer = createMarkdownRenderer(renderMarkup);

        await expect(renderer.render('<b>unsafe</b>')).resolves.toBe('&lt;b&gt;unsafe&lt;/b&gt;');
        await expect(renderer.render('<i>bad</i>')).resolves.toBe('&lt;i&gt;bad&lt;/i&gt;');
    });

    it('clear removes cached entries and pending request state', async () => {
        const first = deferred<RenderMarkupResult>();
        const second = deferred<RenderMarkupResult>();
        const renderMarkup = vi
            .fn<RenderMarkupFn>()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const renderer = createMarkdownRenderer(renderMarkup);

        const staleRender = renderer.render('**x**');
        renderer.clear();
        const currentRender = renderer.render('**x**');

        first.resolve({ id: 'render-1', html: '<p>stale</p>' });
        second.resolve({ id: 'render-2', html: '<p>current</p>' });

        await expect(staleRender).resolves.toContain('stale');
        await expect(currentRender).resolves.toContain('current');
        expect(renderMarkup).toHaveBeenCalledTimes(2);
        expect(renderer.getCached('**x**')).toContain('current');
    });
});

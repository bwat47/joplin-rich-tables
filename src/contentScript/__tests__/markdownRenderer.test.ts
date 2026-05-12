/** @jest-environment jsdom */

import { describe, expect, it, jest } from '@jest/globals';
import { createMarkdownRenderer, type RenderMarkupFn, type RenderMarkupResult } from '../services/markdownRenderer';

jest.mock('../../logger', () => ({
    logger: {
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
    },
}));

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
} {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });

    return { promise, resolve, reject };
}

function render(renderer: ReturnType<typeof createMarkdownRenderer>, markdown: string): Promise<string> {
    return new Promise((resolve) => {
        renderer.renderAsync(markdown, resolve);
    });
}

describe('createMarkdownRenderer', () => {
    it('sanitizes, post-processes, and caches rendered HTML', async () => {
        const renderMarkup = jest.fn<RenderMarkupFn>(async (_markdown, id) => ({
            id,
            html: '<p><strong>ok</strong><span class="joplin-source">raw</span></p>',
        }));
        const renderer = createMarkdownRenderer(renderMarkup);

        const first = await render(renderer, '**ok**');
        const second = await render(renderer, '**ok**');

        expect(first).toContain('<strong>ok</strong>');
        expect(first).not.toContain('joplin-source');
        expect(second).toBe(first);
        expect(renderMarkup).toHaveBeenCalledTimes(1);
        expect(renderer.getCached('**ok**')).toBe(first);
    });

    it('de-dupes concurrent identical render requests', async () => {
        const pending = deferred<RenderMarkupResult>();
        const renderMarkup = jest.fn<RenderMarkupFn>(() => pending.promise);
        const renderer = createMarkdownRenderer(renderMarkup);

        const first = render(renderer, '`x`');
        const second = render(renderer, '`x`');
        pending.resolve({ id: 'render-1', html: '<p><code>x</code></p>' });

        await expect(first).resolves.toContain('<code>x</code>');
        await expect(second).resolves.toContain('<code>x</code>');
        expect(renderMarkup).toHaveBeenCalledTimes(1);
    });

    it('evicts the oldest cache entry after the cache limit', async () => {
        const renderMarkup = jest.fn<RenderMarkupFn>(async (markdown, id) => ({
            id,
            html: `<p>${markdown}</p>`,
        }));
        const renderer = createMarkdownRenderer(renderMarkup);

        for (let index = 0; index < 501; index++) {
            await render(renderer, `value-${index}`);
        }

        expect(renderer.getCached('value-0')).toBeUndefined();
        expect(renderer.getCached('value-1')).toContain('value-1');
        expect(renderer.getCached('value-500')).toContain('value-500');
    });

    it('returns escaped fallback HTML when rendering rejects or returns an error', async () => {
        const renderMarkup = jest
            .fn<RenderMarkupFn>()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce({ id: 'render-2', html: '<img src=x onerror=alert(1)>', error: true });
        const renderer = createMarkdownRenderer(renderMarkup);

        await expect(render(renderer, '<b>unsafe</b>')).resolves.toBe('&lt;b&gt;unsafe&lt;/b&gt;');
        await expect(render(renderer, '<i>bad</i>')).resolves.toBe('&lt;i&gt;bad&lt;/i&gt;');
    });

    it('clear removes cached entries and pending request state', async () => {
        const first = deferred<RenderMarkupResult>();
        const second = deferred<RenderMarkupResult>();
        const renderMarkup = jest
            .fn<RenderMarkupFn>()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const renderer = createMarkdownRenderer(renderMarkup);

        const staleRender = render(renderer, '**x**');
        renderer.clear();
        const currentRender = render(renderer, '**x**');

        first.resolve({ id: 'render-1', html: '<p>stale</p>' });
        second.resolve({ id: 'render-2', html: '<p>current</p>' });

        await expect(staleRender).resolves.toContain('stale');
        await expect(currentRender).resolves.toContain('current');
        expect(renderMarkup).toHaveBeenCalledTimes(2);
        expect(renderer.getCached('**x**')).toContain('current');
    });
});

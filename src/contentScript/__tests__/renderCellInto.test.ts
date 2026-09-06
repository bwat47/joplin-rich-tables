/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import type { MarkdownRenderService } from '../services/markdownRenderer';
import { renderCellMarkdownInto } from '../services/renderCellInto';
import { deferred, htmlFragment } from './testUtils';

function createRenderer(overrides: Partial<MarkdownRenderService> = {}): MarkdownRenderService {
    return {
        getCached: vi.fn(() => undefined),
        render: vi.fn(() => Promise.resolve(htmlFragment(''))),
        clear: vi.fn(),
        ...overrides,
    };
}

function createTarget(connected = true): HTMLElement {
    const el = document.createElement('div');
    if (connected) {
        document.body.appendChild(el);
    }
    return el;
}

describe('renderCellMarkdownInto', () => {
    it('writes cached HTML immediately without requesting a render', () => {
        const renderer = createRenderer({ getCached: vi.fn(() => htmlFragment('<p><strong>cached</strong></p>')) });
        const target = createTarget();

        renderCellMarkdownInto(target, '**cached**', renderer);

        expect(target.innerHTML).toBe('<p><strong>cached</strong></p>');
        expect(renderer.render).not.toHaveBeenCalled();
        target.remove();
    });

    it('normalizes cell text before cache lookup and rendering', () => {
        const rendered = deferred<DocumentFragment>();
        const renderer = createRenderer({ render: vi.fn(() => rendered.promise) });
        const target = createTarget();

        // Escaped pipes are unescaped, and a leading list marker is escaped so the cell
        // renders as inline markdown rather than a list.
        renderCellMarkdownInto(target, '- a \\| b', renderer);

        expect(renderer.getCached).toHaveBeenCalledWith('\\- a | b');
        expect(renderer.render).toHaveBeenCalledWith('\\- a | b');
        rendered.resolve(htmlFragment('<p>- a | b</p>'));
        target.remove();
    });

    it('shows escaped text first, then swaps in the async result', async () => {
        const rendered = deferred<DocumentFragment>();
        const renderer = createRenderer({ render: vi.fn(() => rendered.promise) });
        const target = createTarget();

        renderCellMarkdownInto(target, 'a <b> **c**<br>d', renderer);

        // <br> survives as a real line break; other markup is escaped.
        expect(target.innerHTML).toBe('a &lt;b&gt; **c**<br>d');

        rendered.resolve(htmlFragment('<p>rendered</p>'));
        await rendered.promise;
        await Promise.resolve();

        expect(target.innerHTML).toBe('<p>rendered</p>');
        target.remove();
    });

    it('skips the async swap when the target left the DOM', async () => {
        const rendered = deferred<DocumentFragment>();
        const renderer = createRenderer({ render: vi.fn(() => rendered.promise) });
        const target = createTarget();

        renderCellMarkdownInto(target, '**body**', renderer);
        target.remove();

        rendered.resolve(htmlFragment('<p>rendered</p>'));
        await rendered.promise;
        await Promise.resolve();

        expect(target.innerHTML).toBe('**body**');
    });

    it('does not request a render for plain text', () => {
        const renderer = createRenderer();
        const target = createTarget();

        renderCellMarkdownInto(target, 'plain text', renderer);

        expect(target.innerHTML).toBe('plain text');
        expect(renderer.render).not.toHaveBeenCalled();
        target.remove();
    });

    it('requests a render for HTML entities and emoji shortcodes', () => {
        const renderer = createRenderer();
        const target = createTarget();

        renderCellMarkdownInto(target, 'Test &amp; :smile:', renderer);

        expect(renderer.render).toHaveBeenCalledWith('Test &amp; :smile:');
        target.remove();
    });
});

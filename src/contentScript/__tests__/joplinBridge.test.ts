import { describe, expect, it, vi } from 'vitest';
import { createJoplinBridge } from '../services/joplinBridge';

describe('createJoplinBridge', () => {
    describe('openLink', () => {
        it('resolves when the host reports success', async () => {
            const postMessage = vi.fn(async () => ({ success: true }));
            const bridge = createJoplinBridge(postMessage);

            await expect(bridge.openLink('https://example.com')).resolves.toBeUndefined();
            expect(postMessage).toHaveBeenCalledWith({
                type: 'openLink',
                href: 'https://example.com',
            });
        });

        it('rejects with the host error when the link cannot be opened', async () => {
            const postMessage = vi.fn(async () => ({ success: false, error: 'Error: open failed' }));
            const bridge = createJoplinBridge(postMessage);

            await expect(bridge.openLink('https://example.com')).rejects.toThrow('Error: open failed');
        });

        it('rejects with a fallback message when the host omits the error', async () => {
            const postMessage = vi.fn(async () => ({ success: false }));
            const bridge = createJoplinBridge(postMessage);

            await expect(bridge.openLink('https://example.com')).rejects.toThrow('Unknown error opening link');
        });

        it('resolves when the host returns no result', async () => {
            const postMessage = vi.fn(async () => null);
            const bridge = createJoplinBridge(postMessage);

            await expect(bridge.openLink('https://example.com')).resolves.toBeUndefined();
        });
    });

    describe('renderMarkup', () => {
        it('forwards the markdown and id and returns the host result', async () => {
            const postMessage = vi.fn(async () => ({ id: 'render-1', html: '<p>ok</p>' }));
            const bridge = createJoplinBridge(postMessage);

            await expect(bridge.renderMarkup('# Test', 'render-1')).resolves.toEqual({
                id: 'render-1',
                html: '<p>ok</p>',
            });
            expect(postMessage).toHaveBeenCalledWith({
                type: 'renderMarkup',
                markdown: '# Test',
                id: 'render-1',
            });
        });
    });
});

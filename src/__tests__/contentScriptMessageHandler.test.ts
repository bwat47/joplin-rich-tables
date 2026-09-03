import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentScriptMessageHandler } from '../contentScriptBridge/contentScriptMessageHandler';

vi.mock('../logger', () => ({
    logger: {
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    },
}));

describe('contentScriptMessageHandler', () => {
    const globalValues = vi.fn(async (_keys: string[]) => [true]);
    const values = vi.fn(async (_keys: string[] | string) => ({}));
    const execute = vi.fn(async (_commandName: string, ..._args: unknown[]): Promise<unknown> => ({
        html: '<p>ok</p>',
    }));
    const handler = createContentScriptMessageHandler({
        commands: { execute },
        settings: { globalValues, values },
    });

    beforeEach(() => {
        execute.mockClear();
        globalValues.mockClear();
        values.mockClear();
    });

    it('renders markdown via Joplin commands', async () => {
        const result = await handler({
            type: 'renderMarkup',
            markdown: '# Test',
            id: 'render-1',
        });

        expect(execute).toHaveBeenCalledWith('renderMarkup', 1, '# Test', null, { bodyOnly: true });
        expect(result).toEqual({
            id: 'render-1',
            html: '<p>ok</p>',
        });
    });

    it('normalizes non-object render results to strings', async () => {
        execute.mockResolvedValueOnce('rendered text');

        await expect(
            handler({
                type: 'renderMarkup',
                markdown: 'Test',
                id: 'render-2',
            })
        ).resolves.toEqual({
            id: 'render-2',
            html: 'rendered text',
        });
    });

    it('returns the source markdown when rendering fails', async () => {
        execute.mockRejectedValueOnce(new Error('render failed'));

        await expect(
            handler({
                type: 'renderMarkup',
                markdown: '# Test',
                id: 'render-3',
            })
        ).resolves.toEqual({
            id: 'render-3',
            html: '# Test',
            error: true,
        });
    });

    it('opens links via Joplin commands', async () => {
        execute.mockResolvedValueOnce(undefined);

        const result = await handler({
            type: 'openLink',
            href: 'https://example.com',
        });

        expect(execute).toHaveBeenCalledWith('openItem', 'https://example.com');
        expect(result).toEqual({ success: true });
    });

    it('returns an error when opening a link fails', async () => {
        execute.mockRejectedValueOnce(new Error('open failed'));

        await expect(
            handler({
                type: 'openLink',
                href: 'https://example.com',
            })
        ).resolves.toEqual({
            success: false,
            error: 'Error: open failed',
        });
    });

    it('reads the host editor config', async () => {
        globalValues.mockResolvedValueOnce([true, true]);
        values.mockResolvedValueOnce({
            'tableAppearance.zebraStriping': true,
            'floatingToolbar.showMoveButtons': false,
            'floatingToolbar.showClearButtons': true,
            'floatingToolbar.showAlignmentButtons': false,
            'floatingToolbar.showDeleteTableButton': true,
        });

        const result = await handler({
            type: 'getHostEditorConfig',
        });

        expect(globalValues).toHaveBeenCalledWith(['editor.autoMatchingBraces', 'spellChecker.enabled']);
        expect(values).toHaveBeenCalledWith([
            'tableAppearance.zebraStriping',
            'floatingToolbar.showMoveButtons',
            'floatingToolbar.showClearButtons',
            'floatingToolbar.showAlignmentButtons',
            'floatingToolbar.showDeleteTableButton',
        ]);
        expect(result).toEqual({
            nestedEditor: {
                autoMatchingBraces: true,
                spellcheck: true,
            },
            tableAppearance: {
                zebraStriping: true,
            },
            toolbar: {
                showMoveButtons: false,
                showClearButtons: true,
                showAlignmentButtons: false,
                showDeleteTableButton: true,
            },
        });
    });

    it('ignores invalid messages', async () => {
        await expect(handler(null)).resolves.toBeNull();
        await expect(handler('bad')).resolves.toBeNull();
    });
});

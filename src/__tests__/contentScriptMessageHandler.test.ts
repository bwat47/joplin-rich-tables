import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createContentScriptMessageHandler } from '../contentScriptBridge/contentScriptMessageHandler';

jest.mock('../logger', () => ({
    logger: {
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
    },
}));

describe('contentScriptMessageHandler', () => {
    const globalValues = jest.fn(async (_keys: string[]) => [true]);
    const values = jest.fn(async (_keys: string[] | string) => ({}));
    const execute = jest.fn(
        async (_commandName: string, ..._args: unknown[]): Promise<unknown> => ({
            html: '<p>ok</p>',
        })
    );
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

    it('opens links via Joplin commands', async () => {
        execute.mockResolvedValueOnce(undefined);

        const result = await handler({
            type: 'openLink',
            href: 'https://example.com',
        });

        expect(execute).toHaveBeenCalledWith('openItem', 'https://example.com');
        expect(result).toEqual({ success: true });
    });

    it('reads the host editor config', async () => {
        globalValues.mockResolvedValueOnce([true]);
        values.mockResolvedValueOnce({
            'floatingToolbar.showMoveButtons': false,
            'floatingToolbar.showClearButtons': true,
            'floatingToolbar.showAlignmentButtons': false,
            'floatingToolbar.showDeleteTableButton': true,
        });

        const result = await handler({
            type: 'getHostEditorConfig',
        });

        expect(globalValues).toHaveBeenCalledWith(['editor.autoMatchingBraces']);
        expect(values).toHaveBeenCalledWith([
            'floatingToolbar.showMoveButtons',
            'floatingToolbar.showClearButtons',
            'floatingToolbar.showAlignmentButtons',
            'floatingToolbar.showDeleteTableButton',
        ]);
        expect(result).toEqual({
            nestedEditor: {
                autoMatchingBraces: true,
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

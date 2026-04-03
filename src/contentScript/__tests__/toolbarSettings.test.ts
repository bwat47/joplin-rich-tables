import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ToolbarSettings } from '../../contentScriptBridge/toolbarSettingsBridge';

jest.mock('../../logger', () => ({
    logger: {
        warn: jest.fn(),
    },
}));

describe('toolbarSettings', () => {
    const validSettings: ToolbarSettings = {
        showMoveButtons: false,
        showClearButtons: true,
        showAlignmentButtons: false,
    };

    beforeEach(() => {
        jest.resetModules();
    });

    it('stores the startup snapshot after initialization', async () => {
        const postMessage = jest.fn(async () => validSettings);
        const service = await import('../services/toolbarSettings');
        await service.initToolbarSettings(postMessage);

        expect(service.getToolbarSettings()).toEqual(validSettings);
        await expect(service.waitForToolbarSettings()).resolves.toBeUndefined();
        expect(postMessage).toHaveBeenCalledTimes(1);
    });

    it('returns defaults before initialization completes', async () => {
        let resolveRequest!: (value: ToolbarSettings) => void;
        const postMessage = jest.fn(
            () =>
                new Promise<ToolbarSettings>((resolve) => {
                    resolveRequest = resolve;
                })
        );
        const service = await import('../services/toolbarSettings');
        const initPromise = service.initToolbarSettings(postMessage);

        expect(service.getToolbarSettings()).toEqual({
            showMoveButtons: true,
            showClearButtons: true,
            showAlignmentButtons: true,
        });

        resolveRequest(validSettings);
        await initPromise;

        expect(service.getToolbarSettings()).toEqual(validSettings);
    });

    it('keeps defaults when the startup response is malformed', async () => {
        const postMessage = jest.fn(async () => ({ invalid: true }));
        const service = await import('../services/toolbarSettings');
        await service.initToolbarSettings(postMessage);

        expect(service.getToolbarSettings()).toEqual({
            showMoveButtons: true,
            showClearButtons: true,
            showAlignmentButtons: true,
        });
    });

    it('keeps defaults when the startup request rejects', async () => {
        const postMessage = jest.fn(async () => {
            throw new Error('boom');
        });
        const service = await import('../services/toolbarSettings');
        await service.initToolbarSettings(postMessage);

        expect(service.getToolbarSettings()).toEqual({
            showMoveButtons: true,
            showClearButtons: true,
            showAlignmentButtons: true,
        });
    });
});

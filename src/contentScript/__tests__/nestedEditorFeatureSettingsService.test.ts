import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { NestedEditorFeatureSettings } from '../../contentScriptBridge/editorSettingsBridge';

jest.mock('../../logger', () => ({
    logger: {
        warn: jest.fn(),
    },
}));

describe('nestedEditorFeatureSettingsService', () => {
    const validSettings: NestedEditorFeatureSettings = {
        autoMatchingBraces: true,
    };

    beforeEach(() => {
        jest.resetModules();
    });

    it('stores the startup snapshot after initialization', async () => {
        const postMessage = jest.fn(async () => validSettings);
        const service = await import('../services/nestedEditorFeatureSettingsService');
        await service.initNestedEditorFeatureSettings(postMessage);

        const result = service.getNestedEditorFeatureSettings();

        expect(result).toEqual(validSettings);
        expect(postMessage).toHaveBeenCalledTimes(1);
    });

    it('returns defaults before initialization completes', async () => {
        let resolveRequest: ((value: NestedEditorFeatureSettings) => void) | null = null;
        const postMessage = jest.fn(
            () =>
                new Promise<NestedEditorFeatureSettings>((resolve) => {
                    resolveRequest = resolve;
                })
        );
        const service = await import('../services/nestedEditorFeatureSettingsService');
        const initPromise = service.initNestedEditorFeatureSettings(postMessage);

        expect(service.getNestedEditorFeatureSettings()).toEqual({
            autoMatchingBraces: false,
        });

        resolveRequest?.(validSettings);
        await initPromise;

        expect(service.getNestedEditorFeatureSettings()).toEqual(validSettings);
    });

    it('keeps defaults when the startup response is malformed', async () => {
        const postMessage = jest.fn(async () => ({ invalid: true }));
        const service = await import('../services/nestedEditorFeatureSettingsService');
        await service.initNestedEditorFeatureSettings(postMessage);

        const result = service.getNestedEditorFeatureSettings();

        expect(result).toEqual({
            autoMatchingBraces: false,
        });
    });

    it('keeps defaults when the startup request rejects', async () => {
        const postMessage = jest.fn(async () => {
            throw new Error('boom');
        });
        const service = await import('../services/nestedEditorFeatureSettingsService');
        await service.initNestedEditorFeatureSettings(postMessage);

        const result = service.getNestedEditorFeatureSettings();

        expect(result).toEqual({
            autoMatchingBraces: false,
        });
    });
});

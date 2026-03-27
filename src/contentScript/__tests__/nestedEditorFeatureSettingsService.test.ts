import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { NestedEditorFeatureSettings } from '../../services/nestedEditorFeatureSettings';

jest.mock('../../logger', () => ({
    logger: {
        warn: jest.fn(),
    },
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

describe('nestedEditorFeatureSettingsService', () => {
    const validSettings: NestedEditorFeatureSettings = {
        autoMatchingBraces: true,
    };

    beforeEach(() => {
        jest.resetModules();
    });

    it('caches the first successful response', async () => {
        const postMessage = jest.fn(async () => validSettings);
        const service = await import('../services/nestedEditorFeatureSettingsService');
        service.initNestedEditorFeatureSettings(postMessage);

        const first = await service.getNestedEditorFeatureSettings();
        const second = await service.getNestedEditorFeatureSettings();

        expect(first).toEqual(validSettings);
        expect(second).toEqual(validSettings);
        expect(postMessage).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent initial requests', async () => {
        const pending = deferred<unknown>();
        const postMessage = jest.fn(() => pending.promise);
        const service = await import('../services/nestedEditorFeatureSettingsService');
        service.initNestedEditorFeatureSettings(postMessage);

        const firstPromise = service.getNestedEditorFeatureSettings();
        const secondPromise = service.getNestedEditorFeatureSettings();
        pending.resolve(validSettings);

        const [first, second] = await Promise.all([firstPromise, secondPromise]);

        expect(first).toEqual(validSettings);
        expect(second).toEqual(validSettings);
        expect(postMessage).toHaveBeenCalledTimes(1);
    });

    it('falls back safely when the response is malformed', async () => {
        const postMessage = jest.fn(async () => ({ invalid: true }));
        const service = await import('../services/nestedEditorFeatureSettingsService');
        service.initNestedEditorFeatureSettings(postMessage);

        const result = await service.getNestedEditorFeatureSettings();

        expect(result).toEqual({
            autoMatchingBraces: false,
        });
    });

    it('falls back safely when the request rejects', async () => {
        const postMessage = jest.fn(async () => {
            throw new Error('boom');
        });
        const service = await import('../services/nestedEditorFeatureSettingsService');
        service.initNestedEditorFeatureSettings(postMessage);

        const result = await service.getNestedEditorFeatureSettings();

        expect(result).toEqual({
            autoMatchingBraces: false,
        });
    });
});

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import type { NestedEditorFeatureSettingsDeps } from '../services/nestedEditorFeatureSettings';
import {
    defaultNestedEditorFeatureSettings,
    readNestedEditorFeatureSettings,
} from '../services/nestedEditorFeatureSettings';

jest.mock('../logger', () => ({
    logger: {
        warn: jest.fn(),
    },
}));

describe('nestedEditorFeatureSettings', () => {
    let deps: NestedEditorFeatureSettingsDeps;
    let globalValuesMock: jest.MockedFunction<NestedEditorFeatureSettingsDeps['settings']['globalValues']>;

    beforeEach(() => {
        globalValuesMock = jest.fn(async () => []);
        deps = {
            settings: {
                globalValues: globalValuesMock,
            },
        };
    });

    it('reads the auto matching braces setting', async () => {
        globalValuesMock.mockResolvedValue([true]);

        const result = await readNestedEditorFeatureSettings(deps);

        expect(result).toEqual({
            autoMatchingBraces: true,
        });
    });

    it('falls back to defaults when reading settings fails', async () => {
        globalValuesMock.mockRejectedValue(new Error('boom'));

        await expect(readNestedEditorFeatureSettings(deps)).resolves.toEqual(defaultNestedEditorFeatureSettings());
    });
});

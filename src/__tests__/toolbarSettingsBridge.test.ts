import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ToolbarSettingsDeps } from '../contentScriptBridge/toolbarSettingsBridge';
import {
    defaultToolbarSettings,
    readToolbarSettings,
    TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY,
    TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY,
    TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY,
} from '../contentScriptBridge/toolbarSettingsBridge';

jest.mock('../logger', () => ({
    logger: {
        warn: jest.fn(),
    },
}));

describe('toolbarSettingsBridge', () => {
    let deps: ToolbarSettingsDeps;
    let valuesMock: jest.MockedFunction<ToolbarSettingsDeps['settings']['values']>;

    beforeEach(() => {
        valuesMock = jest.fn(async () => ({}));
        deps = {
            settings: {
                values: valuesMock,
            },
        };
    });

    it('reads the floating toolbar settings', async () => {
        valuesMock.mockResolvedValue({
            [TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY]: false,
            [TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY]: true,
            [TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY]: false,
        });

        const result = await readToolbarSettings(deps);

        expect(valuesMock).toHaveBeenCalledWith([
            TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY,
            TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY,
            TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY,
        ]);
        expect(result).toEqual({
            showMoveButtons: false,
            showClearButtons: true,
            showAlignmentButtons: false,
        });
    });

    it('uses defaults for missing values', async () => {
        valuesMock.mockResolvedValue({
            [TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY]: false,
        });

        const result = await readToolbarSettings(deps);

        expect(result).toEqual({
            showMoveButtons: false,
            showClearButtons: true,
            showAlignmentButtons: true,
        });
    });

    it('falls back to defaults when reading settings fails', async () => {
        valuesMock.mockRejectedValue(new Error('boom'));

        await expect(readToolbarSettings(deps)).resolves.toEqual(defaultToolbarSettings());
    });
});

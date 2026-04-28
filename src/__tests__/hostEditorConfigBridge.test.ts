import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { HostEditorConfigDeps } from '../contentScriptBridge/hostEditorConfigBridge';
import {
    AUTO_MATCHING_BRACES_SETTING_KEY,
    defaultHostEditorConfig,
    readHostEditorConfig,
    TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY,
    TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY,
    TOOLBAR_SHOW_DELETE_TABLE_BUTTON_SETTING_KEY,
    TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY,
} from '../contentScriptBridge/hostEditorConfigBridge';

jest.mock('../logger', () => ({
    logger: {
        warn: jest.fn(),
    },
}));

describe('hostEditorConfigBridge', () => {
    let deps: HostEditorConfigDeps;
    let globalValuesMock: jest.MockedFunction<HostEditorConfigDeps['settings']['globalValues']>;
    let valuesMock: jest.MockedFunction<HostEditorConfigDeps['settings']['values']>;

    beforeEach(() => {
        globalValuesMock = jest.fn(async () => []);
        valuesMock = jest.fn(async () => ({}));
        deps = {
            settings: {
                globalValues: globalValuesMock,
                values: valuesMock,
            },
        };
    });

    it('reads and normalizes the combined host editor config', async () => {
        globalValuesMock.mockResolvedValue([true]);
        valuesMock.mockResolvedValue({
            [TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY]: false,
            [TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY]: true,
            [TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY]: false,
            [TOOLBAR_SHOW_DELETE_TABLE_BUTTON_SETTING_KEY]: true,
        });

        const result = await readHostEditorConfig(deps);

        expect(globalValuesMock).toHaveBeenCalledWith([AUTO_MATCHING_BRACES_SETTING_KEY]);
        expect(valuesMock).toHaveBeenCalledWith([
            TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY,
            TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY,
            TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY,
            TOOLBAR_SHOW_DELETE_TABLE_BUTTON_SETTING_KEY,
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

    it('uses defaults for missing and non-boolean values', async () => {
        globalValuesMock.mockResolvedValue(['true']);
        valuesMock.mockResolvedValue({
            [TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY]: false,
            [TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY]: 'true',
        });

        await expect(readHostEditorConfig(deps)).resolves.toEqual({
            nestedEditor: {
                autoMatchingBraces: false,
            },
            toolbar: {
                showMoveButtons: false,
                showClearButtons: true,
                showAlignmentButtons: true,
                showDeleteTableButton: true,
            },
        });
    });

    it('defaults only the nested editor config when global settings fail', async () => {
        globalValuesMock.mockRejectedValue(new Error('global boom'));
        valuesMock.mockResolvedValue({
            [TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY]: false,
            [TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY]: false,
            [TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY]: false,
            [TOOLBAR_SHOW_DELETE_TABLE_BUTTON_SETTING_KEY]: false,
        });

        await expect(readHostEditorConfig(deps)).resolves.toEqual({
            nestedEditor: defaultHostEditorConfig().nestedEditor,
            toolbar: {
                showMoveButtons: false,
                showClearButtons: false,
                showAlignmentButtons: false,
                showDeleteTableButton: false,
            },
        });
    });

    it('defaults only the toolbar config when plugin settings fail', async () => {
        globalValuesMock.mockResolvedValue([true]);
        valuesMock.mockRejectedValue(new Error('plugin boom'));

        await expect(readHostEditorConfig(deps)).resolves.toEqual({
            nestedEditor: {
                autoMatchingBraces: true,
            },
            toolbar: defaultHostEditorConfig().toolbar,
        });
    });
});

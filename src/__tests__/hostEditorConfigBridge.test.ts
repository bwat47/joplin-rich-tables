import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import type { HostEditorConfigDeps } from '../contentScriptBridge/hostEditorConfigBridge';
import {
    AUTO_MATCHING_BRACES_SETTING_KEY,
    SPELLCHECK_ENABLED_SETTING_KEY,
    TABLE_APPEARANCE_ZEBRA_STRIPING_SETTING_KEY,
    defaultHostEditorConfig,
    isHostEditorConfig,
    readHostEditorConfig,
    TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY,
    TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY,
    TOOLBAR_SHOW_DELETE_TABLE_BUTTON_SETTING_KEY,
    TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY,
    TOOLBAR_SHOW_SORT_BUTTONS_SETTING_KEY,
} from '../contentScriptBridge/hostEditorConfigBridge';

vi.mock('../logger', () => ({
    logger: {
        warn: vi.fn(),
    },
}));

describe('hostEditorConfigBridge', () => {
    let deps: HostEditorConfigDeps;
    let globalValuesMock: MockedFunction<HostEditorConfigDeps['settings']['globalValues']>;
    let valuesMock: MockedFunction<HostEditorConfigDeps['settings']['values']>;

    beforeEach(() => {
        globalValuesMock = vi.fn(async () => []);
        valuesMock = vi.fn(async () => ({}));
        deps = {
            settings: {
                globalValues: globalValuesMock,
                values: valuesMock,
            },
        };
    });

    it('reads and normalizes the combined host editor config', async () => {
        globalValuesMock.mockResolvedValue([true, true]);
        valuesMock.mockResolvedValue({
            [TABLE_APPEARANCE_ZEBRA_STRIPING_SETTING_KEY]: true,
            [TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY]: false,
            [TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY]: true,
            [TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY]: false,
            [TOOLBAR_SHOW_DELETE_TABLE_BUTTON_SETTING_KEY]: true,
            [TOOLBAR_SHOW_SORT_BUTTONS_SETTING_KEY]: false,
        });

        const result = await readHostEditorConfig(deps);

        expect(globalValuesMock).toHaveBeenCalledWith([
            AUTO_MATCHING_BRACES_SETTING_KEY,
            SPELLCHECK_ENABLED_SETTING_KEY,
        ]);
        expect(valuesMock).toHaveBeenCalledWith([
            TABLE_APPEARANCE_ZEBRA_STRIPING_SETTING_KEY,
            TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY,
            TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY,
            TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY,
            TOOLBAR_SHOW_DELETE_TABLE_BUTTON_SETTING_KEY,
            TOOLBAR_SHOW_SORT_BUTTONS_SETTING_KEY,
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
                showSortButtons: false,
            },
        });
    });

    it('uses defaults for missing and non-boolean values', async () => {
        globalValuesMock.mockResolvedValue(['true', 'true']);
        valuesMock.mockResolvedValue({
            [TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY]: false,
            [TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY]: 'true',
        });

        await expect(readHostEditorConfig(deps)).resolves.toEqual({
            nestedEditor: {
                autoMatchingBraces: false,
                spellcheck: false,
            },
            tableAppearance: {
                zebraStriping: false,
            },
            toolbar: {
                showMoveButtons: false,
                showClearButtons: true,
                showAlignmentButtons: true,
                showDeleteTableButton: true,
                showSortButtons: true,
            },
        });
    });

    it('defaults only the nested editor config when global settings fail', async () => {
        globalValuesMock.mockRejectedValue(new Error('global boom'));
        valuesMock.mockResolvedValue({
            [TABLE_APPEARANCE_ZEBRA_STRIPING_SETTING_KEY]: true,
            [TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY]: false,
            [TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY]: false,
            [TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY]: false,
            [TOOLBAR_SHOW_DELETE_TABLE_BUTTON_SETTING_KEY]: false,
            [TOOLBAR_SHOW_SORT_BUTTONS_SETTING_KEY]: false,
        });

        await expect(readHostEditorConfig(deps)).resolves.toEqual({
            nestedEditor: defaultHostEditorConfig().nestedEditor,
            tableAppearance: {
                zebraStriping: true,
            },
            toolbar: {
                showMoveButtons: false,
                showClearButtons: false,
                showAlignmentButtons: false,
                showDeleteTableButton: false,
                showSortButtons: false,
            },
        });
    });

    it('defaults plugin config when plugin settings fail', async () => {
        globalValuesMock.mockResolvedValue([true, true]);
        valuesMock.mockRejectedValue(new Error('plugin boom'));

        await expect(readHostEditorConfig(deps)).resolves.toEqual({
            nestedEditor: {
                autoMatchingBraces: true,
                spellcheck: true,
            },
            tableAppearance: defaultHostEditorConfig().tableAppearance,
            toolbar: defaultHostEditorConfig().toolbar,
        });
    });

    describe('isHostEditorConfig', () => {
        it('accepts a fully populated config', () => {
            expect(isHostEditorConfig(defaultHostEditorConfig())).toBe(true);
        });

        it('accepts a config carrying unknown extra keys', () => {
            const config = defaultHostEditorConfig();

            expect(isHostEditorConfig({ ...config, unexpected: 'value' })).toBe(true);
        });

        it.each([
            ['null', null],
            ['undefined', undefined],
            ['a primitive', 'config'],
            ['an empty object', {}],
        ])('rejects %s', (_label, value) => {
            expect(isHostEditorConfig(value)).toBe(false);
        });

        it('rejects a config missing a section', () => {
            const { nestedEditor } = defaultHostEditorConfig();

            expect(isHostEditorConfig({ nestedEditor })).toBe(false);
        });

        it('rejects a config whose section is null', () => {
            const config = defaultHostEditorConfig();

            expect(isHostEditorConfig({ ...config, toolbar: null })).toBe(false);
        });

        it('rejects a config missing a nested editor field', () => {
            const config = defaultHostEditorConfig();

            expect(
                isHostEditorConfig({
                    ...config,
                    nestedEditor: { autoMatchingBraces: true },
                })
            ).toBe(false);
        });

        it('rejects a config with a non-boolean toolbar field', () => {
            const config = defaultHostEditorConfig();

            expect(
                isHostEditorConfig({
                    ...config,
                    toolbar: { ...config.toolbar, showMoveButtons: 'true' },
                })
            ).toBe(false);
        });

        it('rejects a config with a non-boolean table appearance field', () => {
            const config = defaultHostEditorConfig();

            expect(
                isHostEditorConfig({
                    ...config,
                    tableAppearance: { zebraStriping: 'true' },
                })
            ).toBe(false);
        });
    });
});

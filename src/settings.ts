import joplin from 'api';
import { SettingItemType } from 'api/types';
import {
    TABLE_APPEARANCE_ZEBRA_STRIPING_SETTING_KEY,
    TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY,
    TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY,
    TOOLBAR_SHOW_DELETE_TABLE_BUTTON_SETTING_KEY,
    TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY,
    TOOLBAR_SHOW_SORT_BUTTONS_SETTING_KEY,
} from './contentScriptBridge/hostEditorConfigBridge';

const SETTINGS_SECTION = 'richTables';
export const TOOLBAR_SHOW_INSERT_TABLE_BUTTON_SETTING_KEY = 'toolbar.showInsertTableButton';
export const TOOLBAR_SHOW_SOURCE_MODE_BUTTON_SETTING_KEY = 'toolbar.showSourceModeButton';

export async function registerPluginSettings(): Promise<void> {
    await joplin.settings.registerSection(SETTINGS_SECTION, {
        label: 'Rich Tables',
        iconName: 'fas fa-table',
        description: 'Configure Rich Tables plugin settings',
    });

    await joplin.settings.registerSettings({
        [TABLE_APPEARANCE_ZEBRA_STRIPING_SETTING_KEY]: {
            value: false,
            type: SettingItemType.Bool,
            public: true,
            section: SETTINGS_SECTION,
            label: 'Enable zebra striping',
            description:
                'Shade alternating table body rows using the current Joplin theme (if supported by the current Joplin theme).',
        },
        [TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY]: {
            value: true,
            type: SettingItemType.Bool,
            public: true,
            section: SETTINGS_SECTION,
            label: 'Show move row/column buttons',
            description: 'Display move row and move column actions in the floating table toolbar.',
        },
        [TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY]: {
            value: false,
            type: SettingItemType.Bool,
            public: true,
            section: SETTINGS_SECTION,
            label: 'Show clear row/column/table buttons',
            description: 'Display clear row, clear column, and clear table actions in the floating table toolbar.',
        },
        [TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY]: {
            value: true,
            type: SettingItemType.Bool,
            public: true,
            section: SETTINGS_SECTION,
            label: 'Show alignment buttons',
            description: 'Display align left, center, and right actions in the floating table toolbar.',
        },
        [TOOLBAR_SHOW_DELETE_TABLE_BUTTON_SETTING_KEY]: {
            value: true,
            type: SettingItemType.Bool,
            public: true,
            section: SETTINGS_SECTION,
            label: 'Show delete table button',
            description: 'Display the delete table action in the floating table toolbar.',
        },
        [TOOLBAR_SHOW_SORT_BUTTONS_SETTING_KEY]: {
            value: true,
            type: SettingItemType.Bool,
            public: true,
            section: SETTINGS_SECTION,
            label: 'Show sort buttons',
            description: 'Display the actions that sort table rows by the active column in the floating table toolbar.',
        },
        [TOOLBAR_SHOW_INSERT_TABLE_BUTTON_SETTING_KEY]: {
            value: true,
            type: SettingItemType.Bool,
            public: true,
            section: SETTINGS_SECTION,
            label: 'Show insert table button',
            description: 'Display the insert table button in the editor toolbar. Requires a restart to apply.',
        },
        [TOOLBAR_SHOW_SOURCE_MODE_BUTTON_SETTING_KEY]: {
            value: true,
            type: SettingItemType.Bool,
            public: true,
            section: SETTINGS_SECTION,
            label: 'Show table source mode button',
            description: 'Display the table source mode button in the editor toolbar. Requires a restart to apply.',
        },
    });
}

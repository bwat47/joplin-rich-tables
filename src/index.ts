import joplin from 'api';
import { ContentScriptType, MenuItemLocation, SettingItemType, ToastType, ToolbarButtonLocation } from 'api/types';
import { logger } from './logger';
import { createContentScriptMessageHandler } from './contentScriptBridge/contentScriptMessageHandler';
import {
    TABLE_APPEARANCE_ZEBRA_STRIPING_SETTING_KEY,
    TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY,
    TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY,
    TOOLBAR_SHOW_DELETE_TABLE_BUTTON_SETTING_KEY,
    TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY,
} from './contentScriptBridge/hostEditorConfigBridge';
import { STRUCTURAL_COMMANDS } from './contentScriptBridge/structuralCommandCatalog';

const CONTENT_SCRIPT_ID = 'rich-tables-widget';
const SETTINGS_SECTION = 'richTables';
const JOPLIN_TABLE_EDITING_SETTING_KEY = 'editor.tableEditing';
const TABLE_EDITOR_CONFLICT_MESSAGE =
    "Rich Tables: Joplin's table editor is enabled. To use Rich Tables, disable Joplin's table editor under Joplin settings | Editor tab.";

const INSERT_TABLE_COMMAND = 'richTables.insertTable';

async function warnIfJoplinTableEditorEnabled(): Promise<void> {
    try {
        const [tableEditingEnabled] = await joplin.settings.globalValues([JOPLIN_TABLE_EDITING_SETTING_KEY]);

        if (tableEditingEnabled !== true) {
            return;
        }

        await joplin.views.dialogs.showToast({
            message: TABLE_EDITOR_CONFLICT_MESSAGE,
            type: ToastType.Info,
        });
    } catch (error) {
        logger.warn('Failed to detect Joplin table editor setting', error);
    }
}

joplin.plugins.register({
    onStart: async function () {
        logger.info('Rich Tables plugin starting...');

        await joplin.settings.registerSection(SETTINGS_SECTION, {
            label: 'Rich Tables',
            iconName: 'fas fa-table',
            description: 'Configure Rich Tables appearance and floating toolbar.',
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
                value: true,
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
        });

        await warnIfJoplinTableEditorEnabled();

        await joplin.commands.register({
            name: INSERT_TABLE_COMMAND,
            label: 'Rich Tables - Insert table',
            iconName: 'fas fa-table',
            execute: async () => {
                await joplin.commands.execute('editor.execCommand', {
                    name: 'richTables.insertTableAndActivate',
                });
            },
        });

        const registerTableCommand = async (name: string, label: string) => {
            await joplin.commands.register({
                name,
                label,
                execute: async () => {
                    await joplin.commands.execute('editor.execCommand', {
                        name,
                    });
                },
            });
        };

        for (const { commandName, label } of STRUCTURAL_COMMANDS) {
            await registerTableCommand(commandName, label);
        }

        // Register source mode toggle (shows all tables as raw markdown)
        const TOGGLE_SOURCE_MODE_COMMAND = 'richTables.toggleSourceMode';
        await joplin.commands.register({
            name: TOGGLE_SOURCE_MODE_COMMAND,
            label: 'Rich Tables - Toggle table source mode',
            iconName: 'fas fa-file-code',
            execute: async () => {
                await joplin.commands.execute('editor.execCommand', {
                    name: 'richTables.toggleSourceMode',
                });
            },
        });

        // Create menu items with keyboard shortcuts
        const structuralMenuItems = STRUCTURAL_COMMANDS.map(({ commandName, label, accelerator }) => ({
            label,
            commandName,
            ...(accelerator ? { accelerator } : {}),
        }));

        await joplin.views.menus.create(
            'richTablesMenu',
            'Rich Tables',
            [
                {
                    label: 'Insert table',
                    commandName: INSERT_TABLE_COMMAND,
                    accelerator: 'Alt+Shift+T',
                },
                ...structuralMenuItems,
                {
                    label: 'Toggle source mode',
                    commandName: TOGGLE_SOURCE_MODE_COMMAND,
                    accelerator: 'CmdOrCtrl+Shift+/',
                },
            ],
            MenuItemLocation.Tools
        );

        await joplin.views.toolbarButtons.create(
            'richTablesInsertTable',
            INSERT_TABLE_COMMAND,
            ToolbarButtonLocation.EditorToolbar
        );

        await joplin.views.toolbarButtons.create(
            'richTablesToggleSourceMode',
            TOGGLE_SOURCE_MODE_COMMAND,
            ToolbarButtonLocation.EditorToolbar
        );

        // Handle messages from content script
        await joplin.contentScripts.onMessage(CONTENT_SCRIPT_ID, createContentScriptMessageHandler(joplin));

        // Register the CodeMirror content script after the message handler is ready.
        await joplin.contentScripts.register(
            ContentScriptType.CodeMirrorPlugin,
            CONTENT_SCRIPT_ID,
            './contentScript/tableWidget/tableWidgetExtension.js'
        );

        logger.info('Rich Tables plugin started');
    },
});

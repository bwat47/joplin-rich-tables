import joplin from 'api';
import { ContentScriptType, MenuItemLocation, ToastType, ToolbarButtonLocation } from 'api/types';
import { logger } from './logger';
import { createContentScriptMessageHandler } from './contentScriptBridge/contentScriptMessageHandler';
import { STRUCTURAL_COMMANDS } from './contentScriptBridge/structuralCommandCatalog';
import {
    registerPluginSettings,
    TOOLBAR_SHOW_INSERT_TABLE_BUTTON_SETTING_KEY,
    TOOLBAR_SHOW_SOURCE_MODE_BUTTON_SETTING_KEY,
} from './settings';

const CONTENT_SCRIPT_ID = 'rich-tables-widget';
const JOPLIN_TABLE_EDITING_SETTING_KEY = 'editor.tableEditing';
const TABLE_EDITOR_CONFLICT_MESSAGE =
    "Rich Tables: Joplin's table editor is enabled. To use Rich Tables, disable Joplin's table editor under Joplin settings | Editor tab.";

const INSERT_TABLE_COMMAND = 'richTables.insertTable';
const TOGGLE_SOURCE_MODE_COMMAND = 'richTables.toggleSourceMode';

async function warnIfJoplinTableEditorEnabled(): Promise<void> {
    try {
        const values: unknown[] = await joplin.settings.globalValues([JOPLIN_TABLE_EDITING_SETTING_KEY]);
        const [tableEditingEnabled] = values;

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

async function registerEditorCommand(
    name: string,
    label: string,
    editorCommand: string,
    iconName?: string
): Promise<void> {
    await joplin.commands.register({
        name,
        label,
        ...(iconName ? { iconName } : {}),
        execute: async () => {
            await joplin.commands.execute('editor.execCommand', { name: editorCommand });
        },
    });
}

async function registerCommands(): Promise<void> {
    await registerEditorCommand(
        INSERT_TABLE_COMMAND,
        'Rich Tables - Insert table',
        'richTables.insertTableAndActivate',
        'fas fa-table'
    );

    for (const { commandName, label } of STRUCTURAL_COMMANDS) {
        await registerEditorCommand(commandName, label, commandName);
    }

    // Source mode shows all tables as raw markdown
    await registerEditorCommand(
        TOGGLE_SOURCE_MODE_COMMAND,
        'Rich Tables - Toggle table source mode',
        TOGGLE_SOURCE_MODE_COMMAND,
        'fas fa-file-code'
    );
}

async function registerToolsMenu(): Promise<void> {
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
}

async function registerToolbarButtons(): Promise<void> {
    const toolbarButtonSettings = await joplin.settings.values([
        TOOLBAR_SHOW_INSERT_TABLE_BUTTON_SETTING_KEY,
        TOOLBAR_SHOW_SOURCE_MODE_BUTTON_SETTING_KEY,
    ]);

    if (toolbarButtonSettings[TOOLBAR_SHOW_INSERT_TABLE_BUTTON_SETTING_KEY] !== false) {
        await joplin.views.toolbarButtons.create(
            'richTablesInsertTable',
            INSERT_TABLE_COMMAND,
            ToolbarButtonLocation.EditorToolbar
        );
    }

    if (toolbarButtonSettings[TOOLBAR_SHOW_SOURCE_MODE_BUTTON_SETTING_KEY] !== false) {
        await joplin.views.toolbarButtons.create(
            'richTablesToggleSourceMode',
            TOGGLE_SOURCE_MODE_COMMAND,
            ToolbarButtonLocation.EditorToolbar
        );
    }
}

async function registerContentScript(): Promise<void> {
    // The message handler must be ready before the CodeMirror content script loads.
    await joplin.contentScripts.onMessage(CONTENT_SCRIPT_ID, createContentScriptMessageHandler(joplin));
    await joplin.contentScripts.register(
        ContentScriptType.CodeMirrorPlugin,
        CONTENT_SCRIPT_ID,
        './contentScript/tableWidgetExtension.js'
    );
}

void joplin.plugins.register({
    onStart: async function () {
        logger.info('Rich Tables plugin starting...');
        await registerPluginSettings();
        await warnIfJoplinTableEditorEnabled();
        await registerCommands();
        await registerToolsMenu();
        await registerToolbarButtons();
        await registerContentScript();
        logger.info('Rich Tables plugin started');
    },
});

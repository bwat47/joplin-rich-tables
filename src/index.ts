import joplin from 'api';
import { ContentScriptType, MenuItemLocation, ToolbarButtonLocation } from 'api/types';
import { logger } from './logger';
import { createContentScriptMessageHandler } from './contentScriptBridge/contentScriptMessageHandler';

const CONTENT_SCRIPT_ID = 'rich-tables-widget';

const INSERT_TABLE_COMMAND = 'richTables.insertTable';

joplin.plugins.register({
    onStart: async function () {
        logger.info('Rich Tables plugin starting...');

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

        await registerTableCommand('richTables.addRowAbove', 'Insert row above');
        await registerTableCommand('richTables.addRowBelow', 'Insert row below');
        await registerTableCommand('richTables.addColumnLeft', 'Insert column left');
        await registerTableCommand('richTables.addColumnRight', 'Insert column right');
        await registerTableCommand('richTables.deleteRow', 'Delete row');
        await registerTableCommand('richTables.deleteColumn', 'Delete column');
        await registerTableCommand('richTables.clearRow', 'Clear row');
        await registerTableCommand('richTables.clearColumn', 'Clear column');
        await registerTableCommand('richTables.alignLeft', 'Align column left');
        await registerTableCommand('richTables.alignCenter', 'Align column center');
        await registerTableCommand('richTables.alignRight', 'Align column right');
        await registerTableCommand('richTables.moveRowUp', 'Move row up');
        await registerTableCommand('richTables.moveRowDown', 'Move row down');
        await registerTableCommand('richTables.moveColumnLeft', 'Move column left');
        await registerTableCommand('richTables.moveColumnRight', 'Move column right');
        await registerTableCommand('richTables.clearTable', 'Clear table');
        await registerTableCommand('richTables.deleteTable', 'Delete table');

        // Register source mode toggle (shows all tables as raw markdown)
        const TOGGLE_SOURCE_MODE_COMMAND = 'richTables.toggleSourceMode';
        await joplin.commands.register({
            name: TOGGLE_SOURCE_MODE_COMMAND,
            label: 'Toggle table source mode',
            iconName: 'fas fa-code',
            execute: async () => {
                await joplin.commands.execute('editor.execCommand', {
                    name: 'richTables.toggleSourceMode',
                });
            },
        });

        // Create menu items with keyboard shortcuts
        await joplin.views.menus.create(
            'richTablesMenu',
            'Rich Tables',
            [
                {
                    label: 'Insert table',
                    commandName: INSERT_TABLE_COMMAND,
                    accelerator: 'Alt+Shift+T',
                },
                {
                    label: 'Insert row above',
                    commandName: 'richTables.addRowAbove',
                    accelerator: 'Alt+Shift+Up',
                },
                {
                    label: 'Insert row below',
                    commandName: 'richTables.addRowBelow',
                    accelerator: 'Alt+Shift+Down',
                },
                {
                    label: 'Insert column left',
                    commandName: 'richTables.addColumnLeft',
                    accelerator: 'Alt+Shift+Left',
                },
                {
                    label: 'Insert column right',
                    commandName: 'richTables.addColumnRight',
                    accelerator: 'Alt+Shift+Right',
                },
                {
                    label: 'Delete row',
                    commandName: 'richTables.deleteRow',
                    accelerator: 'Alt+Shift+D',
                },
                {
                    label: 'Clear row',
                    commandName: 'richTables.clearRow',
                    accelerator: 'Alt+Shift+C',
                },
                {
                    label: 'Delete column',
                    commandName: 'richTables.deleteColumn',
                    accelerator: 'CmdOrCtrl+Alt+Shift+D',
                },
                {
                    label: 'Clear column',
                    commandName: 'richTables.clearColumn',
                    accelerator: 'CmdOrCtrl+Alt+Shift+C',
                },
                {
                    label: 'Align left',
                    commandName: 'richTables.alignLeft',
                    accelerator: 'Alt+Shift+Q',
                },
                {
                    label: 'Align center',
                    commandName: 'richTables.alignCenter',
                    accelerator: 'Alt+Shift+W',
                },
                {
                    label: 'Align right',
                    commandName: 'richTables.alignRight',
                    accelerator: 'Alt+Shift+E',
                },
                {
                    label: 'Move row up',
                    commandName: 'richTables.moveRowUp',
                    accelerator: 'CmdOrCtrl+Alt+Up',
                },
                {
                    label: 'Move row down',
                    commandName: 'richTables.moveRowDown',
                    accelerator: 'CmdOrCtrl+Alt+Down',
                },
                {
                    label: 'Move column left',
                    commandName: 'richTables.moveColumnLeft',
                    accelerator: 'CmdOrCtrl+Alt+Left',
                },
                {
                    label: 'Move column right',
                    commandName: 'richTables.moveColumnRight',
                    accelerator: 'CmdOrCtrl+Alt+Right',
                },
                {
                    label: 'Clear table',
                    commandName: 'richTables.clearTable',
                },
                {
                    label: 'Delete table',
                    commandName: 'richTables.deleteTable',
                },
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

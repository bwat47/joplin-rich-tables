import joplin from 'api';
import { ContentScriptType, MenuItemLocation, ToolbarButtonLocation } from 'api/types';
import { logger } from './logger';

const CONTENT_SCRIPT_ID = 'rich-tables-widget';

const INSERT_TABLE_COMMAND = 'richTables.insertTable';

// Joplin's internal MarkupLanguage enum values
const MarkupLanguage = {
    Markdown: 1,
    Html: 2,
} as const;

interface RenderMarkupMessage {
    type: 'renderMarkup';
    markdown: string;
    id: string;
}

interface OpenLinkMessage {
    type: 'openLink';
    href: string;
}

joplin.plugins.register({
    onStart: async function () {
        logger.info('Rich Tables plugin starting...');

        await joplin.commands.register({
            name: INSERT_TABLE_COMMAND,
            label: 'Insert table',
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
        await registerTableCommand('richTables.alignLeft', 'Align column left');
        await registerTableCommand('richTables.alignCenter', 'Align column center');
        await registerTableCommand('richTables.alignRight', 'Align column right');
        await registerTableCommand('richTables.moveRowUp', 'Move row up');
        await registerTableCommand('richTables.moveRowDown', 'Move row down');
        await registerTableCommand('richTables.moveColumnLeft', 'Move column left');
        await registerTableCommand('richTables.moveColumnRight', 'Move column right');

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
                    label: 'Delete column',
                    commandName: 'richTables.deleteColumn',
                    accelerator: 'Ctrl+Alt+Shift+D',
                },
                {
                    label: 'Align left',
                    commandName: 'richTables.alignLeft',
                    accelerator: 'Ctrl+Alt+Left',
                },
                {
                    label: 'Align center',
                    commandName: 'richTables.alignCenter',
                    accelerator: 'Ctrl+Alt+Up',
                },
                {
                    label: 'Align right',
                    commandName: 'richTables.alignRight',
                    accelerator: 'Ctrl+Alt+Right',
                },
                {
                    label: 'Move row up',
                    commandName: 'richTables.moveRowUp',
                    accelerator: 'Alt+Up',
                },
                {
                    label: 'Move row down',
                    commandName: 'richTables.moveRowDown',
                    accelerator: 'Alt+Down',
                },
                {
                    label: 'Move column left',
                    commandName: 'richTables.moveColumnLeft',
                    accelerator: 'Alt+Left',
                },
                {
                    label: 'Move column right',
                    commandName: 'richTables.moveColumnRight',
                    accelerator: 'Alt+Right',
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

        // Register the CodeMirror content script
        await joplin.contentScripts.register(
            ContentScriptType.CodeMirrorPlugin,
            CONTENT_SCRIPT_ID,
            './contentScript/tableWidget/tableWidgetExtension.js'
        );

        // Handle messages from content script
        await joplin.contentScripts.onMessage(CONTENT_SCRIPT_ID, async (message: unknown) => {
            if (typeof message !== 'object' || message === null || !('type' in message)) {
                return null;
            }

            const msgType = (message as { type: string }).type;

            if (msgType === 'renderMarkup') {
                const { markdown, id } = message as RenderMarkupMessage;
                try {
                    const result = await joplin.commands.execute(
                        'renderMarkup',
                        MarkupLanguage.Markdown,
                        markdown,
                        null, // rendererOptions (unused)
                        { bodyOnly: true } // renderOptions - prevents wrapping in rendered-md div
                    );
                    // renderMarkup returns { html: string } or just a string
                    const html =
                        typeof result === 'object' && result !== null && 'html' in result
                            ? (result as { html: string }).html
                            : String(result);
                    logger.debug('Rendered markup:', { markdown, html });
                    return { id, html };
                } catch (error) {
                    logger.error('Failed to render markup:', error);
                    return { id, html: markdown, error: true };
                }
            }

            if (msgType === 'openLink') {
                const { href } = message as OpenLinkMessage;
                try {
                    await joplin.commands.execute('openItem', href);
                    logger.debug('Opened link:', href);
                    return { success: true };
                } catch (error) {
                    logger.error('Failed to open link:', error);
                    return { success: false, error: String(error) };
                }
            }

            return null;
        });

        logger.info('Rich Tables plugin started');
    },
});

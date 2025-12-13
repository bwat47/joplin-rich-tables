import joplin from 'api';
import { ContentScriptType } from 'api/types';
import { logger } from './logger';

const CONTENT_SCRIPT_ID = 'rich-tables-editor';

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

joplin.plugins.register({
    onStart: async function () {
        logger.info('Rich Tables plugin starting...');

        // Register the CodeMirror content script
        await joplin.contentScripts.register(
            ContentScriptType.CodeMirrorPlugin,
            CONTENT_SCRIPT_ID,
            './contentScript/tableEditor.js'
        );

        // Handle messages from content script
        await joplin.contentScripts.onMessage(
            CONTENT_SCRIPT_ID,
            async (message: unknown) => {
                if (
                    typeof message === 'object' &&
                    message !== null &&
                    'type' in message &&
                    (message as { type: string }).type === 'renderMarkup'
                ) {
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
                return null;
            }
        );

        logger.info('Rich Tables plugin started');
    },
});

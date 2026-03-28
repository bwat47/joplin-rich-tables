import { logger } from '../logger';
import type { ContentScriptMessage, OpenLinkMessage, RenderMarkupMessage } from './contentScriptMessages';
import { readNestedEditorFeatureSettings, type NestedEditorFeatureSettingsDeps } from './editorSettingsBridge';
import { readToolbarSettings, type ToolbarSettingsDeps } from './toolbarSettingsBridge';

// Joplin's internal MarkupLanguage enum values
const MarkupLanguage = {
    Markdown: 1,
    Html: 2,
} as const;

interface ContentScriptMessageHandlerDeps {
    commands: {
        execute(commandName: string, ...args: unknown[]): Promise<unknown>;
    };
    settings: NestedEditorFeatureSettingsDeps['settings'] & ToolbarSettingsDeps['settings'];
}

function isContentScriptMessage(message: unknown): message is ContentScriptMessage {
    return typeof message === 'object' && message !== null && 'type' in message;
}

export function createContentScriptMessageHandler(deps: ContentScriptMessageHandlerDeps) {
    return async (message: unknown): Promise<unknown> => {
        if (!isContentScriptMessage(message)) {
            return null;
        }

        switch (message.type) {
            case 'renderMarkup': {
                const { markdown, id } = message as RenderMarkupMessage;
                try {
                    const result = await deps.commands.execute(
                        'renderMarkup',
                        MarkupLanguage.Markdown,
                        markdown,
                        null,
                        { bodyOnly: true }
                    );
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
            case 'openLink': {
                const { href } = message as OpenLinkMessage;
                try {
                    await deps.commands.execute('openItem', href);
                    logger.debug('Opened link:', href);
                    return { success: true };
                } catch (error) {
                    logger.error('Failed to open link:', error);
                    return { success: false, error: String(error) };
                }
            }
            case 'getNestedEditorFeatureSettings':
                return readNestedEditorFeatureSettings(deps);
            case 'getToolbarSettings':
                return readToolbarSettings(deps);
            default:
                return null;
        }
    };
}

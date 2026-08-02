import { logger } from '../logger';
import type { ContentScriptMessage, OpenLinkMessage, RenderMarkupMessage } from './contentScriptMessages';
import { readHostEditorConfig, type HostEditorConfigDeps } from './hostEditorConfigBridge';

// Joplin's internal MarkupLanguage enum values
const MarkupLanguage = {
    Markdown: 1,
    Html: 2,
} as const;

interface ContentScriptMessageHandlerDeps {
    commands: {
        execute(commandName: string, ...args: unknown[]): Promise<unknown>;
    };
    settings: HostEditorConfigDeps['settings'];
}

function isContentScriptMessage(message: unknown): message is ContentScriptMessage {
    return typeof message === 'object' && message !== null && 'type' in message;
}

async function renderMarkup(message: RenderMarkupMessage, deps: ContentScriptMessageHandlerDeps) {
    const { markdown, id } = message;

    try {
        const result = await deps.commands.execute('renderMarkup', MarkupLanguage.Markdown, markdown, null, {
            bodyOnly: true,
        });
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

async function openLink(message: OpenLinkMessage, deps: ContentScriptMessageHandlerDeps) {
    const { href } = message;

    try {
        await deps.commands.execute('openItem', href);
        logger.debug('Opened link:', href);
        return { success: true };
    } catch (error) {
        logger.error('Failed to open link:', error);
        return { success: false, error: String(error) };
    }
}

export function createContentScriptMessageHandler(deps: ContentScriptMessageHandlerDeps) {
    return async (message: unknown): Promise<unknown> => {
        if (!isContentScriptMessage(message)) {
            return null;
        }

        switch (message.type) {
            case 'renderMarkup':
                return renderMarkup(message as RenderMarkupMessage, deps);
            case 'openLink':
                return openLink(message as OpenLinkMessage, deps);
            case 'getHostEditorConfig':
                return readHostEditorConfig(deps);
            default:
                return null;
        }
    };
}

import { logger } from '../logger';
import type {
    ContentScriptMessage,
    OpenLinkMessage,
    OpenLinkResult,
    RenderMarkupMessage,
    RenderMarkupResult,
} from './contentScriptMessages';
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

/** The subset of handler dependencies needed to invoke Joplin commands. */
type CommandDeps = Pick<ContentScriptMessageHandlerDeps, 'commands'>;

function isContentScriptMessage(message: unknown): message is ContentScriptMessage {
    return typeof message === 'object' && message !== null && 'type' in message;
}

async function renderMarkup(message: RenderMarkupMessage, deps: CommandDeps): Promise<RenderMarkupResult> {
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

async function openLink(message: OpenLinkMessage, deps: CommandDeps): Promise<OpenLinkResult> {
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
                return renderMarkup(message, deps);
            case 'openLink':
                return openLink(message, deps);
            case 'getHostEditorConfig':
                return readHostEditorConfig(deps);
            default:
                return null;
        }
    };
}

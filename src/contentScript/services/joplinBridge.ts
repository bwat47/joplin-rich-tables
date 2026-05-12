import type {
    OpenLinkMessage,
    RenderMarkupMessage,
    RenderMarkupResult,
} from '../../contentScriptBridge/contentScriptMessages';

type PostMessageFn = (message: unknown) => Promise<unknown>;

export interface JoplinBridge {
    renderMarkup(markdown: string, id: string): Promise<RenderMarkupResult | null>;
    openLink(href: string): Promise<void>;
}

export function createJoplinBridge(postMessage: PostMessageFn): JoplinBridge {
    return {
        async renderMarkup(markdown, id) {
            const message: RenderMarkupMessage = {
                type: 'renderMarkup',
                markdown,
                id,
            };

            return (await postMessage(message)) as RenderMarkupResult | null;
        },

        async openLink(href) {
            const message: OpenLinkMessage = {
                type: 'openLink',
                href,
            };

            await postMessage(message);
        },
    };
}

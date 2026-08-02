import type {
    OpenLinkMessage,
    OpenLinkResult,
    RenderMarkupMessage,
    RenderMarkupResult,
} from '../../contentScriptBridge/contentScriptMessages';

type PostMessageFn = (message: unknown) => Promise<unknown>;

/** Used when the host reports a link failure without describing it. */
const UNKNOWN_OPEN_LINK_ERROR = 'Unknown error opening link';

export interface JoplinBridge {
    renderMarkup: (markdown: string, id: string) => Promise<RenderMarkupResult | null>;
    openLink: (href: string) => Promise<void>;
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

            const result = (await postMessage(message)) as OpenLinkResult | null;

            // The host answers failures with `success: false` rather than rejecting,
            // so reject here to surface them to the caller's error handling.
            if (result && !result.success) {
                throw new Error(result.error ?? UNKNOWN_OPEN_LINK_ERROR);
            }
        },
    };
}

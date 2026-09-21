import type { GetHostEditorConfigMessage } from './hostEditorConfigBridge';

export interface RenderMarkupMessage {
    type: 'renderMarkup';
    markdown: string;
    id: string;
}

export interface RenderMarkupResult {
    id: string;
    html: string;
    error?: boolean;
}

export interface OpenLinkMessage {
    type: 'openLink';
    href: string;
}

export interface OpenLinkResult {
    success: boolean;
    error?: string;
}

export type ContentScriptMessage = RenderMarkupMessage | OpenLinkMessage | GetHostEditorConfigMessage;

/** Host-supplied transport used to post a `ContentScriptMessage` and await its reply. */
export type PostMessageFn = (message: unknown) => Promise<unknown>;

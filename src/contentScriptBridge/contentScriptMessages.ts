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

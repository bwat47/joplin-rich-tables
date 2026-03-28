import type { GetNestedEditorFeatureSettingsMessage } from './editorSettingsBridge';
import type { GetToolbarSettingsMessage } from './toolbarSettingsBridge';

export interface RenderMarkupMessage {
    type: 'renderMarkup';
    markdown: string;
    id: string;
}

export interface OpenLinkMessage {
    type: 'openLink';
    href: string;
}

export type ContentScriptMessage =
    | RenderMarkupMessage
    | OpenLinkMessage
    | GetNestedEditorFeatureSettingsMessage
    | GetToolbarSettingsMessage;

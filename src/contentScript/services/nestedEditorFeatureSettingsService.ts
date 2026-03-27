import { logger } from '../../logger';
import {
    defaultNestedEditorFeatureSettings,
    GetNestedEditorFeatureSettingsMessage,
    isNestedEditorFeatureSettings,
    type NestedEditorFeatureSettings,
} from '../../services/nestedEditorFeatureSettings';

type PostMessageFn = (message: unknown) => Promise<unknown>;

let postMessageFn: PostMessageFn | null = null;
let cachedSettings: NestedEditorFeatureSettings | null = null;
let pendingSettingsRequest: Promise<NestedEditorFeatureSettings> | null = null;

export function initNestedEditorFeatureSettings(postMessage: PostMessageFn): void {
    postMessageFn = postMessage;
    cachedSettings = null;
    pendingSettingsRequest = null;
}

export async function getNestedEditorFeatureSettings(): Promise<NestedEditorFeatureSettings> {
    if (cachedSettings) {
        return cachedSettings;
    }

    if (pendingSettingsRequest) {
        return pendingSettingsRequest;
    }

    if (!postMessageFn) {
        logger.warn('Nested editor feature settings service not initialized, using defaults');
        return defaultNestedEditorFeatureSettings();
    }

    const request: GetNestedEditorFeatureSettingsMessage = {
        type: 'getNestedEditorFeatureSettings',
    };

    pendingSettingsRequest = postMessageFn(request)
        .then((result) => {
            if (!isNestedEditorFeatureSettings(result)) {
                logger.warn('Received invalid nested editor feature settings, using defaults', result);
                const fallback = defaultNestedEditorFeatureSettings();
                cachedSettings = fallback;
                return fallback;
            }

            cachedSettings = result;
            return result;
        })
        .catch((error) => {
            logger.warn('Failed to fetch nested editor feature settings, using defaults', error);
            const fallback = defaultNestedEditorFeatureSettings();
            cachedSettings = fallback;
            return fallback;
        })
        .finally(() => {
            pendingSettingsRequest = null;
        });

    return pendingSettingsRequest;
}

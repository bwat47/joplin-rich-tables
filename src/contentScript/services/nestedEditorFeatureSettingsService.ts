import { logger } from '../../logger';
import {
    defaultNestedEditorFeatureSettings,
    GetNestedEditorFeatureSettingsMessage,
    isNestedEditorFeatureSettings,
    type NestedEditorFeatureSettings,
} from '../../services/nestedEditorFeatureSettings';

type PostMessageFn = (message: unknown) => Promise<unknown>;

let cachedSettings: NestedEditorFeatureSettings = defaultNestedEditorFeatureSettings();

export async function initNestedEditorFeatureSettings(postMessage: PostMessageFn): Promise<void> {
    cachedSettings = defaultNestedEditorFeatureSettings();
    const request: GetNestedEditorFeatureSettingsMessage = {
        type: 'getNestedEditorFeatureSettings',
    };

    try {
        const result = await postMessage(request);
        if (!isNestedEditorFeatureSettings(result)) {
            logger.warn(
                'Received invalid nested editor feature settings during initialization, using defaults',
                result
            );
            return;
        }

        cachedSettings = result;
    } catch (error) {
        logger.warn('Failed to fetch nested editor feature settings during initialization, using defaults', error);
    }
}

export function getNestedEditorFeatureSettings(): NestedEditorFeatureSettings {
    return cachedSettings;
}

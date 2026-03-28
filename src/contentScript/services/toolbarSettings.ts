import { logger } from '../../logger';
import {
    defaultToolbarSettings,
    GetToolbarSettingsMessage,
    isToolbarSettings,
    type ToolbarSettings,
} from '../../contentScriptBridge/toolbarSettingsBridge';

type PostMessageFn = (message: unknown) => Promise<unknown>;

let cachedSettings: ToolbarSettings = defaultToolbarSettings();
let settingsReadyPromise: Promise<void> = Promise.resolve();

export async function initToolbarSettings(postMessage: PostMessageFn): Promise<void> {
    cachedSettings = defaultToolbarSettings();
    const request: GetToolbarSettingsMessage = {
        type: 'getToolbarSettings',
    };

    settingsReadyPromise = (async () => {
        try {
            const result = await postMessage(request);
            if (!isToolbarSettings(result)) {
                logger.warn('Received invalid toolbar settings during initialization, using defaults', result);
                return;
            }

            cachedSettings = result;
        } catch (error) {
            logger.warn('Failed to fetch toolbar settings during initialization, using defaults', error);
        }
    })();

    await settingsReadyPromise;
}

export function getToolbarSettings(): ToolbarSettings {
    return cachedSettings;
}

export function waitForToolbarSettings(): Promise<void> {
    return settingsReadyPromise;
}

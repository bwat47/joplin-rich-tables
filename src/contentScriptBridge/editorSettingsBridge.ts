import { logger } from '../logger';

export const AUTO_MATCHING_BRACES_SETTING_KEY = 'editor.autoMatchingBraces';

export interface NestedEditorFeatureSettings {
    autoMatchingBraces: boolean;
}

export interface GetNestedEditorFeatureSettingsMessage {
    type: 'getNestedEditorFeatureSettings';
}

export interface NestedEditorFeatureSettingsDeps {
    settings: {
        globalValues(keys: string[]): Promise<unknown[]>;
    };
}

export function defaultNestedEditorFeatureSettings(): NestedEditorFeatureSettings {
    return {
        autoMatchingBraces: false,
    };
}

export function isNestedEditorFeatureSettings(value: unknown): value is NestedEditorFeatureSettings {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as Partial<NestedEditorFeatureSettings>;

    return typeof candidate.autoMatchingBraces === 'boolean';
}

export async function readNestedEditorFeatureSettings(
    deps: NestedEditorFeatureSettingsDeps
): Promise<NestedEditorFeatureSettings> {
    try {
        const [autoMatchingBraces] = await deps.settings.globalValues([AUTO_MATCHING_BRACES_SETTING_KEY]);

        return {
            autoMatchingBraces: Boolean(autoMatchingBraces),
        };
    } catch (error) {
        logger.warn('Failed to read nested editor feature settings, using defaults', error);
        return defaultNestedEditorFeatureSettings();
    }
}

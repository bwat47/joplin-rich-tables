import { logger } from '../logger';

export const TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY = 'floatingToolbar.showMoveButtons';
export const TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY = 'floatingToolbar.showClearButtons';
export const TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY = 'floatingToolbar.showAlignmentButtons';

export interface ToolbarSettings {
    showMoveButtons: boolean;
    showClearButtons: boolean;
    showAlignmentButtons: boolean;
}

export interface GetToolbarSettingsMessage {
    type: 'getToolbarSettings';
}

export interface ToolbarSettingsDeps {
    settings: {
        values(keys: string[] | string): Promise<Record<string, unknown>>;
    };
}

export function defaultToolbarSettings(): ToolbarSettings {
    return {
        showMoveButtons: true,
        showClearButtons: true,
        showAlignmentButtons: true,
    };
}

export function isToolbarSettings(value: unknown): value is ToolbarSettings {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as Partial<ToolbarSettings>;

    return (
        typeof candidate.showMoveButtons === 'boolean' &&
        typeof candidate.showClearButtons === 'boolean' &&
        typeof candidate.showAlignmentButtons === 'boolean'
    );
}

function readBooleanSetting(values: Record<string, unknown>, key: string, fallback: boolean): boolean {
    const value = values[key];

    return typeof value === 'boolean' ? value : fallback;
}

export async function readToolbarSettings(deps: ToolbarSettingsDeps): Promise<ToolbarSettings> {
    const defaults = defaultToolbarSettings();

    try {
        const values = await deps.settings.values([
            TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY,
            TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY,
            TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY,
        ]);

        return {
            showMoveButtons: readBooleanSetting(
                values,
                TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY,
                defaults.showMoveButtons
            ),
            showClearButtons: readBooleanSetting(
                values,
                TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY,
                defaults.showClearButtons
            ),
            showAlignmentButtons: readBooleanSetting(
                values,
                TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY,
                defaults.showAlignmentButtons
            ),
        };
    } catch (error) {
        logger.warn('Failed to read toolbar settings, using defaults', error);
        return defaults;
    }
}

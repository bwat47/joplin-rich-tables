import { logger } from '../logger';

export const AUTO_MATCHING_BRACES_SETTING_KEY = 'editor.autoMatchingBraces';
export const TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY = 'floatingToolbar.showMoveButtons';
export const TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY = 'floatingToolbar.showClearButtons';
export const TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY = 'floatingToolbar.showAlignmentButtons';
export const TOOLBAR_SHOW_DELETE_TABLE_BUTTON_SETTING_KEY = 'floatingToolbar.showDeleteTableButton';

export interface HostEditorConfig {
    nestedEditor: {
        autoMatchingBraces: boolean;
    };
    toolbar: {
        showMoveButtons: boolean;
        showClearButtons: boolean;
        showAlignmentButtons: boolean;
        showDeleteTableButton: boolean;
    };
}

export type NestedEditorHostConfig = HostEditorConfig['nestedEditor'];
export type ToolbarHostConfig = HostEditorConfig['toolbar'];

export interface GetHostEditorConfigMessage {
    type: 'getHostEditorConfig';
}

export interface HostEditorConfigDeps {
    settings: {
        globalValues(keys: string[]): Promise<unknown[]>;
        values(keys: string[] | string): Promise<Record<string, unknown>>;
    };
}

export function defaultHostEditorConfig(): HostEditorConfig {
    return {
        nestedEditor: {
            autoMatchingBraces: false,
        },
        toolbar: {
            showMoveButtons: true,
            showClearButtons: true,
            showAlignmentButtons: true,
            showDeleteTableButton: true,
        },
    };
}

export function isHostEditorConfig(value: unknown): value is HostEditorConfig {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as Partial<HostEditorConfig>;
    const nestedEditor = candidate.nestedEditor;
    const toolbar = candidate.toolbar;

    return (
        typeof nestedEditor === 'object' &&
        nestedEditor !== null &&
        typeof nestedEditor.autoMatchingBraces === 'boolean' &&
        typeof toolbar === 'object' &&
        toolbar !== null &&
        typeof toolbar.showMoveButtons === 'boolean' &&
        typeof toolbar.showClearButtons === 'boolean' &&
        typeof toolbar.showAlignmentButtons === 'boolean' &&
        typeof toolbar.showDeleteTableButton === 'boolean'
    );
}

function readBooleanSetting(values: Record<string, unknown>, key: string, fallback: boolean): boolean {
    const value = values[key];

    return typeof value === 'boolean' ? value : fallback;
}

async function readNestedEditorConfig(deps: HostEditorConfigDeps): Promise<NestedEditorHostConfig> {
    const defaults = defaultHostEditorConfig().nestedEditor;

    try {
        const [autoMatchingBraces] = await deps.settings.globalValues([AUTO_MATCHING_BRACES_SETTING_KEY]);

        return {
            autoMatchingBraces:
                typeof autoMatchingBraces === 'boolean' ? autoMatchingBraces : defaults.autoMatchingBraces,
        };
    } catch (error) {
        logger.warn('Failed to read nested editor host config, using defaults', error);
        return defaults;
    }
}

async function readToolbarConfig(deps: HostEditorConfigDeps): Promise<ToolbarHostConfig> {
    const defaults = defaultHostEditorConfig().toolbar;

    try {
        const values = await deps.settings.values([
            TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY,
            TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY,
            TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY,
            TOOLBAR_SHOW_DELETE_TABLE_BUTTON_SETTING_KEY,
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
            showDeleteTableButton: readBooleanSetting(
                values,
                TOOLBAR_SHOW_DELETE_TABLE_BUTTON_SETTING_KEY,
                defaults.showDeleteTableButton
            ),
        };
    } catch (error) {
        logger.warn('Failed to read toolbar host config, using defaults', error);
        return defaults;
    }
}

export async function readHostEditorConfig(deps: HostEditorConfigDeps): Promise<HostEditorConfig> {
    const [nestedEditor, toolbar] = await Promise.all([readNestedEditorConfig(deps), readToolbarConfig(deps)]);

    return {
        nestedEditor,
        toolbar,
    };
}

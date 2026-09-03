import { logger } from '../logger';

export const AUTO_MATCHING_BRACES_SETTING_KEY = 'editor.autoMatchingBraces';
export const SPELLCHECK_ENABLED_SETTING_KEY = 'spellChecker.enabled';
export const TABLE_APPEARANCE_ZEBRA_STRIPING_SETTING_KEY = 'tableAppearance.zebraStriping';
export const TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY = 'floatingToolbar.showMoveButtons';
export const TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY = 'floatingToolbar.showClearButtons';
export const TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY = 'floatingToolbar.showAlignmentButtons';
export const TOOLBAR_SHOW_DELETE_TABLE_BUTTON_SETTING_KEY = 'floatingToolbar.showDeleteTableButton';

export interface HostEditorConfig {
    nestedEditor: {
        autoMatchingBraces: boolean;
        spellcheck: boolean;
    };
    tableAppearance: {
        zebraStriping: boolean;
    };
    toolbar: {
        showMoveButtons: boolean;
        showClearButtons: boolean;
        showAlignmentButtons: boolean;
        showDeleteTableButton: boolean;
    };
}

export type NestedEditorHostConfig = HostEditorConfig['nestedEditor'];
type TableAppearanceHostConfig = HostEditorConfig['tableAppearance'];
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
            spellcheck: false,
        },
        tableAppearance: {
            zebraStriping: false,
        },
        toolbar: {
            showMoveButtons: true,
            showClearButtons: true,
            showAlignmentButtons: true,
            showDeleteTableButton: true,
        },
    };
}

/**
 * Checks that `value` is a non-null object carrying a boolean under every key of `shape`.
 * Extra keys are ignored, matching the tolerant validation the bridge has always applied.
 */
function isBooleanShape(value: unknown, shape: Record<string, boolean>): boolean {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as Record<string, unknown>;

    return Object.keys(shape).every((key) => typeof candidate[key] === 'boolean');
}

/**
 * The expected keys are derived from {@link defaultHostEditorConfig} so the guard stays exhaustive:
 * adding a field to `HostEditorConfig` forces a matching default, which this check then picks up.
 * A future non-boolean field is a compile error here rather than a silently unvalidated field.
 */
export function isHostEditorConfig(value: unknown): value is HostEditorConfig {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as Partial<HostEditorConfig>;
    const defaults = defaultHostEditorConfig();

    return (
        isBooleanShape(candidate.nestedEditor, defaults.nestedEditor) &&
        isBooleanShape(candidate.tableAppearance, defaults.tableAppearance) &&
        isBooleanShape(candidate.toolbar, defaults.toolbar)
    );
}

function readBooleanSetting(values: Record<string, unknown>, key: string, fallback: boolean): boolean {
    const value = values[key];

    return typeof value === 'boolean' ? value : fallback;
}

async function readNestedEditorConfig(deps: HostEditorConfigDeps): Promise<NestedEditorHostConfig> {
    const defaults = defaultHostEditorConfig().nestedEditor;

    try {
        const [autoMatchingBraces, spellcheck] = await deps.settings.globalValues([
            AUTO_MATCHING_BRACES_SETTING_KEY,
            SPELLCHECK_ENABLED_SETTING_KEY,
        ]);

        return {
            autoMatchingBraces:
                typeof autoMatchingBraces === 'boolean' ? autoMatchingBraces : defaults.autoMatchingBraces,
            spellcheck: typeof spellcheck === 'boolean' ? spellcheck : defaults.spellcheck,
        };
    } catch (error) {
        logger.warn('Failed to read nested editor host config, using defaults', error);
        return defaults;
    }
}

interface PluginHostConfig {
    tableAppearance: TableAppearanceHostConfig;
    toolbar: ToolbarHostConfig;
}

async function readPluginConfig(deps: HostEditorConfigDeps): Promise<PluginHostConfig> {
    const defaults = defaultHostEditorConfig();

    try {
        const values = await deps.settings.values([
            TABLE_APPEARANCE_ZEBRA_STRIPING_SETTING_KEY,
            TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY,
            TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY,
            TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY,
            TOOLBAR_SHOW_DELETE_TABLE_BUTTON_SETTING_KEY,
        ]);

        return {
            tableAppearance: {
                zebraStriping: readBooleanSetting(
                    values,
                    TABLE_APPEARANCE_ZEBRA_STRIPING_SETTING_KEY,
                    defaults.tableAppearance.zebraStriping
                ),
            },
            toolbar: {
                showMoveButtons: readBooleanSetting(
                    values,
                    TOOLBAR_SHOW_MOVE_BUTTONS_SETTING_KEY,
                    defaults.toolbar.showMoveButtons
                ),
                showClearButtons: readBooleanSetting(
                    values,
                    TOOLBAR_SHOW_CLEAR_BUTTONS_SETTING_KEY,
                    defaults.toolbar.showClearButtons
                ),
                showAlignmentButtons: readBooleanSetting(
                    values,
                    TOOLBAR_SHOW_ALIGNMENT_BUTTONS_SETTING_KEY,
                    defaults.toolbar.showAlignmentButtons
                ),
                showDeleteTableButton: readBooleanSetting(
                    values,
                    TOOLBAR_SHOW_DELETE_TABLE_BUTTON_SETTING_KEY,
                    defaults.toolbar.showDeleteTableButton
                ),
            },
        };
    } catch (error) {
        logger.warn('Failed to read plugin host config, using defaults', error);
        return {
            tableAppearance: defaults.tableAppearance,
            toolbar: defaults.toolbar,
        };
    }
}

export async function readHostEditorConfig(deps: HostEditorConfigDeps): Promise<HostEditorConfig> {
    const [nestedEditor, pluginConfig] = await Promise.all([readNestedEditorConfig(deps), readPluginConfig(deps)]);

    return {
        nestedEditor,
        ...pluginConfig,
    };
}

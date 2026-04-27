import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { NestedEditorHostConfig } from '../../contentScriptBridge/hostEditorConfigBridge';

export function createNestedEditorFeatureExtensions(featureSettings: NestedEditorHostConfig): Extension[] {
    if (!featureSettings.autoMatchingBraces) {
        return [];
    }

    return [closeBrackets(), keymap.of(closeBracketsKeymap)];
}

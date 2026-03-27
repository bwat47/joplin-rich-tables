import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { NestedEditorFeatureSettings } from '../../services/nestedEditorFeatureSettings';

export function createNestedEditorFeatureExtensions(featureSettings: NestedEditorFeatureSettings): Extension[] {
    if (!featureSettings.autoMatchingBraces) {
        return [];
    }

    return [closeBrackets(), keymap.of(closeBracketsKeymap)];
}

import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { NestedEditorHostConfig } from '../../contentScriptBridge/hostEditorConfigBridge';

export function createNestedEditorFeatureExtensions(featureSettings: NestedEditorHostConfig): Extension[] {
    const extensions: Extension[] = [];

    if (featureSettings.autoMatchingBraces) {
        extensions.push(closeBrackets(), keymap.of(closeBracketsKeymap));
    }

    if (featureSettings.spellcheck) {
        extensions.push(EditorView.contentAttributes.of({ spellcheck: 'true' }));
    }

    return extensions;
}

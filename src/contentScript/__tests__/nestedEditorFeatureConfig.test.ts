import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from '@jest/globals';
import { createNestedEditorFeatureExtensions } from '../nestedEditor/nestedEditorFeatureConfig';

describe('nestedEditorFeatureConfig', () => {
    it('returns valid close-bracket extensions when auto matching braces is enabled', () => {
        const extensions = createNestedEditorFeatureExtensions({ autoMatchingBraces: true, spellcheck: false });
        expect(extensions.length).toBeGreaterThan(0);
        expect(() => EditorState.create({ extensions })).not.toThrow();
    });

    it('returns no extensions when all features are disabled', () => {
        expect(createNestedEditorFeatureExtensions({ autoMatchingBraces: false, spellcheck: false })).toHaveLength(0);
    });

    it('enables the spellcheck content attribute when spellcheck is enabled', () => {
        const extensions = createNestedEditorFeatureExtensions({ autoMatchingBraces: false, spellcheck: true });
        const state = EditorState.create({ extensions });
        expect(state.facet(EditorView.contentAttributes)).toContainEqual({ spellcheck: 'true' });
    });
});

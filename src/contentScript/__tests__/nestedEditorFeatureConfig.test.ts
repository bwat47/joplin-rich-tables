import { EditorState } from '@codemirror/state';
import { describe, expect, it } from '@jest/globals';
import { createNestedEditorFeatureExtensions } from '../nestedEditor/nestedEditorFeatureConfig';

describe('nestedEditorFeatureConfig', () => {
    it('returns valid close-bracket extensions when auto matching braces is enabled', () => {
        const extensions = createNestedEditorFeatureExtensions({ autoMatchingBraces: true });
        expect(extensions.length).toBeGreaterThan(0);
        expect(() => EditorState.create({ extensions })).not.toThrow();
    });

    it('returns no extensions when auto matching braces is disabled', () => {
        expect(createNestedEditorFeatureExtensions({ autoMatchingBraces: false })).toHaveLength(0);
    });
});

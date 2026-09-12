import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { createNestedEditorFeatureExtensions } from '../nestedEditor/nestedEditorFeatureConfig';

describe('nestedEditorFeatureConfig', () => {
    it('inserts a matching close bracket when auto matching braces is enabled', () => {
        const extensions = createNestedEditorFeatureExtensions({ autoMatchingBraces: true, spellcheck: false });
        const view = new EditorView({ state: EditorState.create({ extensions }) });

        try {
            const handled = view.state
                .facet(EditorView.inputHandler)
                .some((handler) =>
                    handler(view, 0, 0, '(', () => view.state.update({ changes: { from: 0, insert: '(' } }))
                );

            expect(handled).toBe(true);
            expect(view.state.doc.toString()).toBe('()');
            expect(view.state.selection.main.anchor).toBe(1);
        } finally {
            view.destroy();
        }
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

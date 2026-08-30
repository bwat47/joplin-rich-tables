/**
 * @vitest-environment jsdom
 */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { linkDestinationWrapPlugin } from '../nestedEditor/decorationPlugins';
import { createNestedEditorMarkdownExtension } from '../nestedEditor/nestedEditorMarkdown';
import { CLASS_NESTED_EDITOR_URL } from '../shared/tableDomClasses';

let mountedView: EditorView | null = null;

afterEach(() => {
    mountedView?.destroy();
    mountedView = null;
});

describe('nested editor decoration plugins', () => {
    it('wraps link and image destinations without marking visible URL text', () => {
        const parent = document.createElement('div');
        const doc = [
            '[label](https://formatted.example/path)',
            'https://bare.example/path',
            '<https://autolink.example/path>',
            '![alt](https://image.example/path)',
            '![resource](:/0123456789abcdef0123456789abcdef)',
        ].join(' ');
        mountedView = new EditorView({
            parent,
            state: EditorState.create({
                doc,
                extensions: [createNestedEditorMarkdownExtension(), linkDestinationWrapPlugin],
            }),
        });

        const wrappedText = [...parent.querySelectorAll(`.${CLASS_NESTED_EDITOR_URL}`)].map(
            (element) => element.textContent
        );
        expect(wrappedText).toEqual([
            'https://formatted.example/path',
            'https://image.example/path',
            ':/0123456789abcdef0123456789abcdef',
        ]);
    });
});

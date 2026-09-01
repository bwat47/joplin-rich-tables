/**
 * @vitest-environment jsdom
 */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { linkWrapPlugin } from '../nestedEditor/decorationPlugins';
import { createNestedEditorMarkdownExtension } from '../nestedEditor/nestedEditorMarkdown';
import { CLASS_NESTED_EDITOR_LINK } from '../shared/tableDomClasses';

let mountedView: EditorView | null = null;

afterEach(() => {
    mountedView?.destroy();
    mountedView = null;
});

function wrappedTextFor(doc: string): string[] {
    const parent = document.createElement('div');
    mountedView = new EditorView({
        parent,
        state: EditorState.create({
            doc,
            extensions: [createNestedEditorMarkdownExtension(), linkWrapPlugin],
        }),
    });

    return [...parent.querySelectorAll(`.${CLASS_NESTED_EDITOR_LINK}`)].map((element) => element.textContent ?? '');
}

describe('nested editor decoration plugins', () => {
    it('wraps whole links and images, including the label, without marking visible URL text', () => {
        const wrappedText = wrappedTextFor(
            [
                '[label](https://formatted.example/path)',
                'https://bare.example/path',
                '<https://autolink.example/path>',
                '![alt](https://image.example/path)',
                '![resource](:/0123456789abcdef0123456789abcdef)',
            ].join(' ')
        );

        expect(wrappedText).toEqual([
            '[label](https://formatted.example/path)',
            '![alt](https://image.example/path)',
            '![resource](:/0123456789abcdef0123456789abcdef)',
        ]);
    });

    it('covers a label that has no wrap opportunities of its own', () => {
        const label = 'a'.repeat(58) + 'b';

        expect(wrappedTextFor(`[${label}](https://sqlserverbuilds.example/#build)`)).toEqual([
            `[${label}](https://sqlserverbuilds.example/#build)`,
        ]);
    });

    it('leaves links without a destination alone', () => {
        expect(wrappedTextFor('[reference][label] and [shortcut] and plain [brackets]')).toEqual([]);
    });
});

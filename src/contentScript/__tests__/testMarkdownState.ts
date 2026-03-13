import { markdown } from '@codemirror/lang-markdown';
import { EditorState, type Extension } from '@codemirror/state';
import { GFM } from '@lezer/markdown';

export function createMarkdownState(doc: string, extensions: Extension[] = []): EditorState {
    return EditorState.create({
        doc,
        extensions: [
            markdown({
                extensions: [GFM],
            }),
            ...extensions,
        ],
    });
}

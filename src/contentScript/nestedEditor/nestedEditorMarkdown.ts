import { markdown } from '@codemirror/lang-markdown';
import type { Extension } from '@codemirror/state';
import { Autolink, Strikethrough, type MarkdownConfig } from '@lezer/markdown';

const nestedEditorRemovedBlockParsers = [
    'ATXHeading',
    'Blockquote',
    'BulletList',
    'FencedCode',
    'HTMLBlock',
    'HorizontalRule',
    'IndentedCode',
    'LinkReference',
    'OrderedList',
    'SetextHeading',
    'Table',
    'TaskList',
] as const;

const nestedEditorInlineMarkdownConfig: MarkdownConfig = {
    remove: nestedEditorRemovedBlockParsers,
};

export function createNestedEditorMarkdownExtension(): Extension {
    return markdown({
        extensions: [Strikethrough, Autolink, nestedEditorInlineMarkdownConfig],
        addKeymap: false,
    });
}

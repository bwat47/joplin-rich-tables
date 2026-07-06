import { describe, expect, it } from 'vitest';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { createNestedEditorMarkdownExtension } from '../nestedEditor/nestedEditorMarkdown';

function getNodeNames(doc: string): string[] {
    const state = EditorState.create({
        doc,
        extensions: [createNestedEditorMarkdownExtension()],
    });

    ensureSyntaxTree(state, state.doc.length, 100);

    const names: string[] = [];
    syntaxTree(state).iterate({
        enter: (node) => {
            names.push(node.name);
        },
    });

    return names;
}

describe('nestedEditorMarkdown', () => {
    it('does not parse headings or lists as block nodes', () => {
        const names = getNodeNames(['# Heading', '- item', '1. ordered'].join('\n'));

        expect(names).not.toContain('ATXHeading1');
        expect(names).not.toContain('BulletList');
        expect(names).not.toContain('OrderedList');
    });

    it('does not parse table-like cell content as a markdown table', () => {
        const names = getNodeNames(['| a | b |', '| --- | --- |', '| c | d |'].join('\n'));

        expect(names).not.toContain('Table');
        expect(names).not.toContain('TableHeader');
        expect(names).not.toContain('TableRow');
        expect(names).not.toContain('TableCell');
    });

    it('keeps inline markdown parsing', () => {
        const names = getNodeNames('Before `code` and ~~strike~~ and https://example.com');

        expect(names).toContain('InlineCode');
        expect(names).toContain('Strikethrough');
        expect(names).toContain('URL');
    });
});

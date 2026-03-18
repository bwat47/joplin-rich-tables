import type { EditorState } from '@codemirror/state';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { buildIsolatedRootTableInsertRewrite } from './rootTableInsertRewrite';

export interface RootTablePasteRewrite {
    changes: {
        from: number;
        to: number;
        insert: string;
    };
    selectionAnchor: number;
    /**
     * Absolute table start in the post-change document.
     */
    tableFrom: number;
}

function normalizeClipboardLineEndings(text: string): string {
    return text.replace(/\r\n?/g, '\n');
}

function trimOuterBlankLines(text: string): string {
    const lines = text.split('\n');

    while (lines.length > 0 && lines[0].trim().length === 0) {
        lines.shift();
    }

    while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) {
        lines.pop();
    }

    return lines.join('\n');
}

export function parseSinglePastedTable(text: string): MarkdownTable | null {
    const normalizedText = normalizeClipboardLineEndings(text);
    const trimmedText = trimOuterBlankLines(normalizedText);
    if (trimmedText.length === 0) {
        return null;
    }

    const table = MarkdownTable.parse(trimmedText);
    if (!table) {
        return null;
    }

    const nonEmptyLineCount = trimmedText.split('\n').filter((line) => line.trim().length > 0).length;
    const expectedLineCount = table.rowCount + 1;

    return nonEmptyLineCount === expectedLineCount ? table : null;
}

export function buildRootTablePasteRewrite(
    state: EditorState,
    from: number,
    to: number,
    clipboardText: string
): RootTablePasteRewrite | null {
    const table = parseSinglePastedTable(clipboardText);
    if (!table) {
        return null;
    }
    const canonicalTableText = table.serialize();
    const rewrite = buildIsolatedRootTableInsertRewrite(state, from, to, canonicalTableText);
    if (!rewrite) {
        return null;
    }

    return {
        ...rewrite,
        selectionAnchor: rewrite.tableFrom,
    };
}

import type { EditorState } from '@codemirror/state';
import { MarkdownTable } from '../tableModel/MarkdownTable';

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

function countTrailingBlankLinesBeforeBoundary(text: string): number {
    if (text.length === 0 || !text.endsWith('\n')) {
        return 0;
    }

    const lines = text.split('\n');
    let index = lines.length - 2;
    let blankLineCount = 0;

    while (index >= 0 && lines[index].trim().length === 0) {
        blankLineCount++;
        index--;
    }

    return blankLineCount;
}

function countLeadingBlankLinesAfterBoundary(text: string): number {
    if (text.length === 0 || !text.startsWith('\n')) {
        return 0;
    }

    const lines = text.split('\n');
    let index = 1;
    let blankLineCount = 0;

    while (index < lines.length && lines[index].trim().length === 0) {
        blankLineCount++;
        index++;
    }

    return blankLineCount;
}

function hasNonWhitespace(text: string): boolean {
    return text.trim().length > 0;
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

    const startLine = state.doc.lineAt(from);
    const endLine = state.doc.lineAt(to);
    const textBeforeFrom = state.doc.sliceString(startLine.from, from);
    const selectedText = state.doc.sliceString(from, to);
    const textAfterTo = state.doc.sliceString(to, endLine.to);

    if (textBeforeFrom.trim().length > 0 || selectedText.trim().length > 0 || textAfterTo.trim().length > 0) {
        return null;
    }

    const replaceFrom = startLine.from;
    const replaceTo = endLine.to;
    const beforeText = state.doc.sliceString(0, replaceFrom);
    const afterText = state.doc.sliceString(replaceTo);
    const canonicalTableText = table.serialize();
    const insertsIntoEmptyDocument = state.doc.length === 0;
    const needsLeadingSeparator =
        insertsIntoEmptyDocument ||
        (hasNonWhitespace(beforeText) && countTrailingBlankLinesBeforeBoundary(beforeText) < 1);
    const insertsAtDocumentEnd = replaceTo === state.doc.length && state.doc.length > 0;
    const needsTrailingSeparator =
        insertsIntoEmptyDocument ||
        insertsAtDocumentEnd ||
        (hasNonWhitespace(afterText) && countLeadingBlankLinesAfterBoundary(afterText) < 1);
    const prefix = needsLeadingSeparator ? '\n' : '';
    const suffix = needsTrailingSeparator ? '\n' : '';
    const insert = prefix + canonicalTableText + suffix;
    const tableFrom = replaceFrom + prefix.length;

    return {
        changes: {
            from: replaceFrom,
            to: replaceTo,
            insert,
        },
        selectionAnchor: tableFrom,
        tableFrom,
    };
}

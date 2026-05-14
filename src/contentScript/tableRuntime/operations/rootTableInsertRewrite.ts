import type { EditorState } from '@codemirror/state';
import {
    countLeadingBlankLinesAfterBoundary,
    countTrailingBlankLinesBeforeBoundary,
    REQUIRED_TABLE_BOUNDARY_BLANK_LINES,
} from '../tableBoundarySpacing';

export interface RootTableInsertRewrite {
    changes: {
        from: number;
        to: number;
        insert: string;
    };
    /**
     * Absolute table start in the post-change document.
     */
    tableFrom: number;
}

function hasNonWhitespace(text: string): boolean {
    return text.trim().length > 0;
}

function computeLeadingNewlines(beforeText: string): number {
    if (!hasNonWhitespace(beforeText)) return 0;
    const existingBlanks = countTrailingBlankLinesBeforeBoundary(beforeText);
    if (existingBlanks >= REQUIRED_TABLE_BOUNDARY_BLANK_LINES) return 0;
    const endsWithNewline = beforeText.endsWith('\n');
    return (endsWithNewline ? 0 : 1) + (REQUIRED_TABLE_BOUNDARY_BLANK_LINES - existingBlanks);
}

function computeTrailingNewlines(afterText: string): number {
    if (!hasNonWhitespace(afterText)) return 0;
    const existingBlanks = countLeadingBlankLinesAfterBoundary(afterText);
    if (existingBlanks >= REQUIRED_TABLE_BOUNDARY_BLANK_LINES) return 0;
    const startsWithNewline = afterText.startsWith('\n');
    return (startsWithNewline ? 0 : 1) + (REQUIRED_TABLE_BOUNDARY_BLANK_LINES - existingBlanks);
}

export function buildRootTableInsertRewrite(
    state: EditorState,
    replaceFrom: number,
    replaceTo: number,
    tableText: string
): RootTableInsertRewrite {
    const beforeText = state.doc.sliceString(0, replaceFrom);
    const afterText = state.doc.sliceString(replaceTo);
    const insertsIntoEmptyDocument = state.doc.length === 0;
    const insertsAtDocumentEnd = replaceTo === state.doc.length && state.doc.length > 0;

    const prefix = insertsIntoEmptyDocument ? '\n' : '\n'.repeat(computeLeadingNewlines(beforeText));
    const suffix =
        insertsIntoEmptyDocument || insertsAtDocumentEnd ? '\n' : '\n'.repeat(computeTrailingNewlines(afterText));
    const insert = prefix + tableText + suffix;
    const tableFrom = replaceFrom + prefix.length;

    return {
        changes: {
            from: replaceFrom,
            to: replaceTo,
            insert,
        },
        tableFrom,
    };
}

export function buildIsolatedRootTableInsertRewrite(
    state: EditorState,
    from: number,
    to: number,
    tableText: string
): RootTableInsertRewrite | null {
    const startLine = state.doc.lineAt(from);
    const endLine = state.doc.lineAt(to);
    const textBeforeFrom = state.doc.sliceString(startLine.from, from);
    const selectedText = state.doc.sliceString(from, to);
    const textAfterTo = state.doc.sliceString(to, endLine.to);

    if (textBeforeFrom.trim().length > 0 || selectedText.trim().length > 0 || textAfterTo.trim().length > 0) {
        return null;
    }

    return buildRootTableInsertRewrite(state, startLine.from, endLine.to, tableText);
}

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

function buildRootTableInsertRewrite(
    state: EditorState,
    replaceFrom: number,
    replaceTo: number,
    tableText: string
): RootTableInsertRewrite {
    const beforeText = state.doc.sliceString(0, replaceFrom);
    const afterText = state.doc.sliceString(replaceTo);
    const insertsIntoEmptyDocument = state.doc.length === 0;
    const needsLeadingSeparator =
        insertsIntoEmptyDocument ||
        (hasNonWhitespace(beforeText) &&
            countTrailingBlankLinesBeforeBoundary(beforeText) < REQUIRED_TABLE_BOUNDARY_BLANK_LINES);
    const insertsAtDocumentEnd = replaceTo === state.doc.length && state.doc.length > 0;
    const needsTrailingSeparator =
        insertsIntoEmptyDocument ||
        insertsAtDocumentEnd ||
        (hasNonWhitespace(afterText) &&
            countLeadingBlankLinesAfterBoundary(afterText) < REQUIRED_TABLE_BOUNDARY_BLANK_LINES);
    const prefix = needsLeadingSeparator ? '\n' : '';
    const suffix = needsTrailingSeparator ? '\n' : '';
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

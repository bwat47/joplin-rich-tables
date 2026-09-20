import type { EditorState, Text } from '@codemirror/state';
import {
    hasRequiredBlankLinesAfter,
    hasRequiredBlankLinesBefore,
    isBlankLineContent,
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

function hasNeighbouringText(doc: Text, from: number, to: number): boolean {
    return from < to && !isBlankLineContent(doc.sliceString(from, to));
}

/**
 * Newlines to insert before the table: end the current line if needed, then one blank line.
 * Already-separated or empty prefixes add nothing.
 */
function computeLeadingNewlines(doc: Text, replaceFrom: number): number {
    if (!hasNeighbouringText(doc, 0, replaceFrom)) {
        return 0;
    }
    const atLineStart = doc.lineAt(replaceFrom).from === replaceFrom;
    if (atLineStart && hasRequiredBlankLinesBefore(doc, replaceFrom)) {
        return 0;
    }
    return (atLineStart ? 0 : 1) + REQUIRED_TABLE_BOUNDARY_BLANK_LINES;
}

/** Newlines to insert after the table: start a new line if needed, then one blank line. */
function computeTrailingNewlines(doc: Text, replaceTo: number): number {
    if (!hasNeighbouringText(doc, replaceTo, doc.length)) {
        return 0;
    }
    const atLineEnd = doc.lineAt(replaceTo).to === replaceTo;
    if (atLineEnd && hasRequiredBlankLinesAfter(doc, replaceTo)) {
        return 0;
    }
    return (atLineEnd ? 0 : 1) + REQUIRED_TABLE_BOUNDARY_BLANK_LINES;
}

export function buildRootTableInsertRewrite(
    state: EditorState,
    replaceFrom: number,
    replaceTo: number,
    tableText: string
): RootTableInsertRewrite {
    const { doc } = state;
    const insertsIntoEmptyDocument = doc.length === 0;
    const insertsAtDocumentEnd = replaceTo === doc.length && doc.length > 0;

    const prefix = insertsIntoEmptyDocument ? '\n' : '\n'.repeat(computeLeadingNewlines(doc, replaceFrom));
    const suffix =
        insertsIntoEmptyDocument || insertsAtDocumentEnd ? '\n' : '\n'.repeat(computeTrailingNewlines(doc, replaceTo));
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

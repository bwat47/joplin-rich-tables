import type { EditorState, Text } from '@codemirror/state';
import {
    needsLeadingSeparator,
    needsTrailingSeparator,
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

/**
 * Newlines to insert before the table: end the current line if needed, then one blank line.
 * Already-separated line starts add nothing.
 */
function computeLeadingNewlines(doc: Text, replaceFrom: number): number {
    if (!needsLeadingSeparator(doc, replaceFrom)) {
        return 0;
    }
    const atLineStart = doc.lineAt(replaceFrom).from === replaceFrom;
    return (atLineStart ? 0 : 1) + REQUIRED_TABLE_BOUNDARY_BLANK_LINES;
}

/** Newlines to insert after the table: start a new line if needed, then one blank line. */
function computeTrailingNewlines(doc: Text, replaceTo: number): number {
    if (!needsTrailingSeparator(doc, replaceTo)) {
        return 0;
    }
    const atLineEnd = doc.lineAt(replaceTo).to === replaceTo;
    return (atLineEnd ? 0 : 1) + REQUIRED_TABLE_BOUNDARY_BLANK_LINES;
}

export function buildRootTableInsertRewrite(
    state: EditorState,
    replaceFrom: number,
    replaceTo: number,
    tableText: string
): RootTableInsertRewrite {
    const { doc } = state;
    const prefix = '\n'.repeat(computeLeadingNewlines(doc, replaceFrom));
    const suffix = '\n'.repeat(computeTrailingNewlines(doc, replaceTo));
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

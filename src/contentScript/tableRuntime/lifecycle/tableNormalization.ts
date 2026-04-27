import { Annotation } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import type { TableContext } from '../../tableModel/tableContext';
import {
    countLeadingBlankLinesAfterBoundary,
    countTrailingBlankLinesBeforeBoundary,
    REQUIRED_TABLE_BOUNDARY_BLANK_LINES,
} from '../tableBoundarySpacing';

export const normalizeBeforeEditAnnotation = Annotation.define<boolean>();

export interface NormalizedTableReplacement {
    insert: string;
    tableText: string;
    tableFrom: number;
}

/**
 * Returns canonical table markdown plus missing blank-line boundaries when needed.
 * The table serializer stays table-only; boundary spacing depends on document context.
 */
export function getNormalizedTableReplacementIfChanged(
    state: EditorState,
    ctx: Pick<TableContext, 'from' | 'to' | 'table' | 'text'>
): NormalizedTableReplacement | null {
    const tableText = ctx.table.serialize();
    const beforeText = state.doc.sliceString(0, ctx.from);
    const afterText = state.doc.sliceString(ctx.to);
    const needsLeadingSeparator =
        countTrailingBlankLinesBeforeBoundary(beforeText) < REQUIRED_TABLE_BOUNDARY_BLANK_LINES;
    const needsTrailingSeparator = countLeadingBlankLinesAfterBoundary(afterText) < REQUIRED_TABLE_BOUNDARY_BLANK_LINES;
    const prefix = needsLeadingSeparator ? '\n' : '';
    const suffix = needsTrailingSeparator ? '\n' : '';
    const insert = prefix + tableText + suffix;

    if (insert === ctx.text) {
        return null;
    }

    return {
        insert,
        tableText,
        tableFrom: ctx.from + prefix.length,
    };
}

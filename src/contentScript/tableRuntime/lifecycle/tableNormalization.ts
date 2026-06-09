import { Annotation } from '@codemirror/state';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import type { TableContext } from '../../tableModel/tableContext';
import { setActiveCellEffect } from '../../tableState/activeCellState';
import { rebuildTableWidgetsEffect } from '../../tableState/tableWidgetEffects';
import { createActiveCellForTableText } from '../activeCell/activeCellFactory';
import type { ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { beginOpenCellRequestEffect, triggerOpenCellRequestEffect, type OpenCellRequest } from '../openCellRequest';
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

export type NormalizeTableBeforeOpenPlan =
    | { type: 'not-needed' }
    | { type: 'aborted' }
    | { type: 'dispatch'; spec: TransactionSpec };

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

export function planNormalizeTableBeforeOpen(params: {
    state: EditorState;
    resolvedActiveCell: ResolvedActiveCell;
    request: OpenCellRequest;
}): NormalizeTableBeforeOpenPlan {
    if (!params.request.normalizeIfNeeded) {
        return { type: 'not-needed' };
    }

    const replacement = getNormalizedTableReplacementIfChanged(params.state, params.resolvedActiveCell.ctx);
    if (!replacement) {
        return { type: 'not-needed' };
    }

    const nextActiveCell = createActiveCellForTableText({
        tableFrom: replacement.tableFrom,
        tableText: replacement.tableText,
        target: params.resolvedActiveCell.activeCell,
    });
    if (!nextActiveCell) {
        return { type: 'aborted' };
    }

    return {
        type: 'dispatch',
        spec: {
            changes: {
                from: params.resolvedActiveCell.tableFrom,
                to: params.resolvedActiveCell.tableTo,
                insert: replacement.insert,
            },
            selection: { anchor: nextActiveCell.selectionAnchor },
            effects: [
                setActiveCellEffect.of(nextActiveCell.activeCell),
                beginOpenCellRequestEffect.of({
                    ...params.request,
                    activeCell: nextActiveCell.activeCell,
                    normalizeIfNeeded: false,
                }),
                triggerOpenCellRequestEffect.of({ requestId: params.request.requestId }),
                rebuildTableWidgetsEffect.of({ tableFrom: replacement.tableFrom }),
            ],
            annotations: normalizeBeforeEditAnnotation.of(true),
            scrollIntoView: false,
        },
    };
}

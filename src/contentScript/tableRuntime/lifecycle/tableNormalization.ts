import { Annotation } from '@codemirror/state';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import type { TableContext } from '../../tableModel/tableContext';
import { setActiveCellEffect } from '../../tableState/activeCellState';
import { rebuildTableWidgetsEffect } from '../../tableState/tableWidgetEffects';
import { createActiveCellForTableText } from '../activeCell/activeCellFactory';
import type { ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import {
    beginOpenCellRequestEffect,
    getOpenCellRequestById,
    triggerOpenCellRequestEffect,
    type OpenCellRequest,
} from '../openCellRequest';
import {
    countLeadingBlankLinesAfterBoundary,
    countTrailingBlankLinesBeforeBoundary,
    REQUIRED_TABLE_BOUNDARY_BLANK_LINES,
} from '../tableBoundarySpacing';

export const normalizeBeforeEditAnnotation = Annotation.define<boolean>();

interface NormalizedTableReplacement {
    /** Document range `insert` replaces. */
    from: number;
    to: number;
    insert: string;
    tableText: string;
    tableFrom: number;
}

interface TableBoundaryPadding {
    prefix: string;
    suffix: string;
}

export type NormalizeTableBeforeOpenPlan =
    { type: 'not-needed' } | { type: 'aborted' } | { type: 'dispatch'; spec: TransactionSpec };

/**
 * Blank-line padding the table needs to stay separated from its surroundings.
 * A single newline per side is enough: the replaced range is line-bounded, so the
 * neighbouring line breaks already outside it combine with the padding to form the blank line.
 *
 * Document edges count as unseparated, so a table at the very start or end of the note is
 * padded too. That is intended: a table flush against the document start is kept off the
 * first line so there is always a newline before it.
 */
function resolveBoundaryPadding(state: EditorState, ctx: Pick<TableContext, 'from' | 'to'>): TableBoundaryPadding {
    const beforeText = state.doc.sliceString(0, ctx.from);
    const afterText = state.doc.sliceString(ctx.to);
    const needsLeadingSeparator =
        countTrailingBlankLinesBeforeBoundary(beforeText) < REQUIRED_TABLE_BOUNDARY_BLANK_LINES;
    const needsTrailingSeparator = countLeadingBlankLinesAfterBoundary(afterText) < REQUIRED_TABLE_BOUNDARY_BLANK_LINES;

    return {
        prefix: needsLeadingSeparator ? '\n' : '',
        suffix: needsTrailingSeparator ? '\n' : '',
    };
}

/**
 * Returns canonical table markdown plus missing blank-line boundaries when needed.
 * The table serializer stays table-only; boundary spacing depends on document context.
 */
function getNormalizedTableReplacementIfChanged(
    state: EditorState,
    ctx: Pick<TableContext, 'from' | 'to' | 'table' | 'text'>
): NormalizedTableReplacement | null {
    const tableText = ctx.table.serialize();
    const { prefix, suffix } = resolveBoundaryPadding(state, ctx);
    const insert = prefix + tableText + suffix;

    if (insert === ctx.text) {
        return null;
    }

    return {
        from: ctx.from,
        to: ctx.to,
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
    const currentRequest = getOpenCellRequestById(params.state, params.request.requestId);
    if (!currentRequest) {
        return { type: 'aborted' };
    }

    if (!currentRequest.normalizeIfNeeded) {
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
                from: replacement.from,
                to: replacement.to,
                insert: replacement.insert,
            },
            selection: { anchor: nextActiveCell.selectionAnchor },
            effects: [
                setActiveCellEffect.of(nextActiveCell.activeCell),
                beginOpenCellRequestEffect.of({
                    ...currentRequest,
                    activeCell: nextActiveCell.activeCell,
                    normalizeIfNeeded: false,
                }),
                triggerOpenCellRequestEffect.of({ requestId: currentRequest.requestId }),
                rebuildTableWidgetsEffect.of(undefined),
            ],
            annotations: normalizeBeforeEditAnnotation.of(true),
            scrollIntoView: false,
        },
    };
}

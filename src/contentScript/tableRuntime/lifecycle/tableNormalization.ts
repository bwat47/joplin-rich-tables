import { Annotation } from '@codemirror/state';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import type { TableContext } from '../../tableModel/tableContext';
import { setActiveCellEffect } from '../../tableState/activeCellState';
import { rebuildTableWidgetsEffect } from '../../tableState/tableWidgetEffects';
import { createActiveCellForTableText, type ActiveCellSelectionTarget } from '../activeCell/activeCellFactory';
import type { ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import {
    beginOpenCellRequestEffect,
    getOpenCellRequestById,
    triggerOpenCellRequestEffect,
    type OpenCellRequest,
} from '../openCellRequest';
import type { CellCoords } from '../../tableModel/types';
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

/** Canonical-form repair to fold into the transaction that enters a cell. */
export interface CellEntryNormalization {
    changes: { from: number; to: number; insert: string };
    /** Where `coords` lands once the replacement is applied. */
    target: ActiveCellSelectionTarget;
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

/**
 * Normalization to apply in the same transaction that enters `coords`, or null when the
 * table is already canonical.
 *
 * Entry transactions are dispatched from the event that triggered them, so folding the
 * repair in keeps the document change on that event. Repairing a frame later instead
 * leaves the host holding a note body the editor has already moved past, which it then
 * writes back over the newer document. See {@link planNormalizeTableBeforeOpen} for the
 * deferred path still used by entry points that resolve their cell from editor state.
 */
export function planCellEntryNormalization(params: {
    state: EditorState;
    ctx: Pick<TableContext, 'from' | 'to' | 'table' | 'text'>;
    coords: CellCoords;
}): CellEntryNormalization | null {
    const replacement = getNormalizedTableReplacementIfChanged(params.state, params.ctx);
    if (!replacement) {
        return null;
    }

    const target = createActiveCellForTableText({
        tableFrom: replacement.tableFrom,
        tableText: replacement.tableText,
        target: params.coords,
    });
    if (!target) {
        return null;
    }

    return {
        changes: { from: replacement.from, to: replacement.to, insert: replacement.insert },
        target,
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

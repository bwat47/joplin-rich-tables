import {
    EditorState,
    type Extension,
    type SelectionRange,
    type Transaction,
    type TransactionSpec,
} from '@codemirror/state';

import type { TableContext } from '../../tableModel/tableContext';
import { getPendingOpenCellRequest } from '../../tableState/openCellRequestState';
import { getResolvedActiveCell } from '../../tableState/resolvedActiveCell';
import { isEffectiveRawMode } from '../../tableState/sourceMode';
import { containsPos, getTableContextAtPos } from '../../tableState/tableContextField';
import { prepareEdgeCellEntry, type EdgeCellTarget } from '../cellActivation';
import { hasPlainRenderedTableCaret } from '../renderedTableCaret';
import {
    countBlankLinesInRun,
    resolveAdjoiningTable,
    scanNewlinesBackward,
    scanNewlinesForward,
    type AdjoiningTable,
    type TableSide,
} from './tableBoundaryResolution';
import { isBlankLineContent, REQUIRED_TABLE_BOUNDARY_BLANK_LINES } from './tableBoundarySpacing';

type DeletionDirection = 'backward' | 'forward';
/** A native cut with no selection removes whole lines, so it is not a directed deletion. */
type DeletionKind = DeletionDirection | 'linewiseCut';

/** An old-document range a deletion removes, and whether it also inserts. */
interface DeletedSpan {
    from: number;
    to: number;
    insertsText: boolean;
}

/**
 * Newlines a protected interior separator can occupy: the required blank lines plus the
 * line break that ends the adjoining line. Used as a scan limit, not a deletion threshold.
 */
const PROTECTED_SEPARATOR_NEWLINES = REQUIRED_TABLE_BOUNDARY_BLANK_LINES + 1;

function resolveDeletionKind(transaction: Transaction): DeletionKind | null {
    if (transaction.isUserEvent('delete.backward')) {
        return 'backward';
    }

    if (transaction.isUserEvent('delete.forward')) {
        return 'forward';
    }

    // CodeMirror cuts linewise when nothing is selected, so the caret's column has no
    // bearing on what disappears.
    if (
        transaction.isUserEvent('delete.cut') &&
        transaction.startState.selection.ranges.every((range) => range.empty)
    ) {
        return 'linewiseCut';
    }

    return null;
}

/** Offset of the character a one-step deletion at `head` removes. */
function deletedCharOffset(head: number, direction: DeletionDirection): number {
    return direction === 'forward' ? head : head - 1;
}

/**
 * True when this deletion would edit the table an in-flight open-cell request is entering.
 *
 * A request does not hand focus to the nested editor until the next frame. Until it mounts,
 * the main editor owns the keyboard with the caret sitting in the table's replaced range, so
 * a repeat deletion would edit the hidden Markdown that this filter exists to protect.
 * Deletions elsewhere in the document are none of this filter's business, so they must still
 * pass.
 */
function isDeletingIntoPendingOpenCell(transaction: Transaction): boolean {
    const state = transaction.startState;
    if (isEffectiveRawMode(state) || !getPendingOpenCellRequest(state)) {
        return false;
    }

    const resolved = getResolvedActiveCell(state);
    if (!resolved) {
        return false;
    }

    const { head } = state.selection.main;
    if (!containsPos(resolved.ctx, head)) {
        return false;
    }

    return Boolean(transaction.changes.touchesRange(resolved.ctx.from, resolved.ctx.to));
}

/** The table this range's deletion would reach, or null when it stays outside one. */
function resolveDeletionTargetTable(
    transaction: Transaction,
    range: SelectionRange,
    direction: DeletionDirection
): TableContext | null {
    const state = transaction.startState;
    const deletedCharFrom = deletedCharOffset(range.head, direction);
    if (deletedCharFrom < 0 || deletedCharFrom >= state.doc.length) {
        return null;
    }
    // A newline can be table separation even when the table begins at the change's other
    // endpoint. Let the boundary resolver decide whether it is protected or surplus.
    if (state.doc.sliceString(deletedCharFrom, deletedCharFrom + 1) === '\n') {
        return null;
    }

    // CodeMirror's deletion commands remove one contiguous range anchored at the caret, so
    // the character next to the caret is always part of it - including word- and line-wise
    // deletion, which stops at the line boundary and reaches the table on the following
    // press. Probing that one position identifies the table being deleted into without
    // walking the change set; `touchesRange` then confirms this transaction is that deletion.
    const targetPos = range.head + (direction === 'forward' ? 1 : -1);
    if (!transaction.changes.touchesRange(targetPos)) {
        return null;
    }

    return getTableContextAtPos(state, targetPos);
}

/**
 * The changed old-document range strictly overlapping `[from, to)`, or null.
 * Change ranges are disjoint, so at most one can overlap a single character.
 */
function resolveOverlappingChange(transaction: Transaction, from: number, to: number): DeletedSpan | null {
    let overlapping: DeletedSpan | null = null;
    transaction.changes.iterChanges((changedFrom, changedTo, _insertedFrom, _insertedTo, inserted) => {
        if (changedFrom < to && changedTo > from) {
            overlapping = { from: changedFrom, to: changedTo, insertsText: inserted.length > 0 };
        }
    });
    return overlapping;
}

/** The newlines beside the table edge that a deletion moving away from it must leave in place. */
function resolveProtectedSeparator(state: EditorState, target: AdjoiningTable): { from: number; to: number } {
    const { ctx, side } = target;
    return side === 'after'
        ? { from: scanNewlinesBackward(state, ctx.from, PROTECTED_SEPARATOR_NEWLINES).edge, to: ctx.from }
        : { from: ctx.to, to: scanNewlinesForward(state, ctx.to, PROTECTED_SEPARATOR_NEWLINES).edge };
}

/**
 * The table whose boundary separation this deletion would consume, or null.
 *
 * A table is kept clear of its neighbours by `REQUIRED_TABLE_BOUNDARY_BLANK_LINES`, and a
 * newline counts as part of that boundary in either of two ways:
 *
 * - it sits directly against a table edge, so removing it merges the neighbouring line into
 *   the table's own line and leaves the caret parked on the widget edge; or
 * - it belongs to a run of at most that many blank lines, so removing it drops the
 *   separation below the blank line the plugin would immediately restore.
 *
 * Deleting toward the table enters its edge cell; deleting away preserves the newline and
 * moves the caret. Surplus blank lines in the middle of a longer run are ordinary text and
 * still delete normally, one press at a time.
 */
function resolveBoundarySeparatorTable(
    transaction: Transaction,
    head: number,
    direction: DeletionDirection
): AdjoiningTable | null {
    const state = transaction.startState;
    // A deletion reaches the table it moves toward first, so that side wins a tie.
    const preferredSide: TableSide = direction === 'backward' ? 'before' : 'after';
    const deletedFrom = deletedCharOffset(head, direction);
    if (deletedFrom < 0 || deletedFrom >= state.doc.length) {
        return null;
    }
    if (state.doc.sliceString(deletedFrom, deletedFrom + 1) !== '\n') {
        return null;
    }
    // Boundary protection only applies when the deletion actually consumes this newline,
    // not when it merely stops next to it.
    if (!resolveOverlappingChange(transaction, deletedFrom, deletedFrom + 1)) {
        return null;
    }

    const edgeAdjacent = resolveAdjoiningTable(state, deletedFrom, deletedFrom + 1, preferredSide);
    if (edgeAdjacent) {
        return edgeAdjacent;
    }

    const limit = PROTECTED_SEPARATOR_NEWLINES + 1;
    const backward = scanNewlinesBackward(state, head, limit);
    const forward = scanNewlinesForward(state, head, limit);
    if (countBlankLinesInRun(backward, forward) > REQUIRED_TABLE_BOUNDARY_BLANK_LINES) {
        return null;
    }

    return resolveAdjoiningTable(state, backward.edge, forward.edge, preferredSide);
}

/**
 * Replacement for a deletion moving away from a table boundary: keep the separator, apply
 * whatever else the deletion covered, and otherwise make the one-position move the key asked
 * for so it is not dead.
 *
 * A deletion command removes one contiguous range anchored at the caret, so the separator sits
 * at its caret-facing end and trimming it leaves the rest contiguous. A deletion that also
 * inserts is not shaped like that, so it passes through untouched.
 */
function prepareSeparatorPreservingDeletion(
    transaction: Transaction,
    range: SelectionRange,
    direction: DeletionDirection,
    target: AdjoiningTable
): TransactionSpec | null {
    const state = transaction.startState;
    // Mapping multiple ranges would be surprising and is not needed for entry.
    if (state.selection.ranges.length > 1) {
        return null;
    }

    const separatorFrom = deletedCharOffset(range.head, direction);
    const deleted = resolveOverlappingChange(transaction, separatorFrom, separatorFrom + 1);
    if (!deleted || deleted.insertsText) {
        return null;
    }

    const isBackward = direction === 'backward';
    const protectedSeparator = resolveProtectedSeparator(state, target);
    const trimmedFrom = isBackward ? deleted.from : Math.max(deleted.from, protectedSeparator.to);
    const trimmedTo = isBackward ? Math.min(deleted.to, protectedSeparator.from) : deleted.to;
    if (trimmedTo <= trimmedFrom) {
        return {
            selection: { anchor: range.head + (isBackward ? -1 : 1) },
            scrollIntoView: transaction.scrollIntoView,
        };
    }

    return {
        changes: { from: trimmedFrom, to: trimmedTo },
        selection: { anchor: trimmedFrom },
        scrollIntoView: transaction.scrollIntoView,
    };
}

/** Replacement transaction for a deletion that reaches a table boundary, or null to pass it through. */
function prepareTableBoundaryDeletion(
    transaction: Transaction,
    range: SelectionRange,
    direction: DeletionDirection
): TransactionSpec | null {
    // An explicit selection is a deliberate range deletion, a table-spanning one included.
    if (!range.empty) {
        return null;
    }

    const state = transaction.startState;
    const isBackward = direction === 'backward';
    const edges: EdgeCellTarget = isBackward ? { row: 'last', col: 'last' } : { row: 'first', col: 'first' };
    const deletionTarget = resolveDeletionTargetTable(transaction, range, direction);
    if (deletionTarget) {
        return prepareEdgeCellEntry(state, deletionTarget, edges, isBackward ? 'end' : 'start');
    }

    const boundaryTarget = resolveBoundarySeparatorTable(transaction, range.head, direction);
    if (!boundaryTarget) {
        return null;
    }

    if (boundaryTarget.side === (isBackward ? 'before' : 'after')) {
        return prepareEdgeCellEntry(state, boundaryTarget.ctx, edges, isBackward ? 'end' : 'start');
    }

    return prepareSeparatorPreservingDeletion(transaction, range, direction, boundaryTarget);
}

/**
 * True when a linewise cut would take a line the table needs.
 *
 * A cut removes whole lines, so protection is decided per line rather than per character.
 * Dropping a line that holds text leaves the blank lines around it in place, so only two
 * shapes are unsafe: a line holding hidden table source, and a blank line that keeps a table
 * clear of its neighbour.
 */
function hasUncuttableLine(transaction: Transaction): boolean {
    const state = transaction.startState;
    return state.selection.ranges.some((range) => {
        if (getTableContextAtPos(state, range.head)) {
            return true;
        }

        const line = state.doc.lineAt(range.head);
        if (!isBlankLineContent(line.text)) {
            return false;
        }

        // The line's own break is what separates the table; the caret may sit before it.
        return Boolean(resolveBoundarySeparatorTable(transaction, line.to, 'forward'));
    });
}

/**
 * Keeps deletions in the main editor from eating hidden table source or the blank-line
 * separation around a table: deleting toward a table enters its edge cell instead.
 */
export const tableBoundaryDeletionExtension: Extension = EditorState.transactionFilter.of((transaction) => {
    const kind = resolveDeletionKind(transaction);
    if (!kind || !transaction.docChanged) {
        return [transaction];
    }

    // Drop the deletion outright: the caret is already on its way into a cell.
    if (isDeletingIntoPendingOpenCell(transaction)) {
        return [];
    }

    if (!hasPlainRenderedTableCaret(transaction.startState)) {
        return [transaction];
    }

    // A cut is one gesture over whole lines, so it is answered as a whole: dropping it in
    // part would leave a table half cut. Cancelling keeps every caret where it was, and the
    // clipboard still holds the lines.
    if (kind === 'linewiseCut') {
        return hasUncuttableLine(transaction) ? [] : [transaction];
    }

    // Several carets can reach tables in one gesture. A deletion toward a table enters the
    // first in document order and drops the rest because a cell editor holds one caret. An
    // away-from-table caret move requires a lone caret; multi-range deletion passes through.
    for (const range of transaction.startState.selection.ranges) {
        const spec = prepareTableBoundaryDeletion(transaction, range, kind);
        if (spec) {
            return [spec];
        }
    }

    return [transaction];
});

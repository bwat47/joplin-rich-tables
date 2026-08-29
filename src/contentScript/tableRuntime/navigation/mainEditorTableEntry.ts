import {
    EditorState,
    Prec,
    type Extension,
    type SelectionRange,
    type Transaction,
    type TransactionSpec,
} from '@codemirror/state';
import { BlockType, Direction, keymap, type BlockInfo, type EditorView } from '@codemirror/view';
import { getActiveCell } from '../../tableState/activeCellState';
import { fromUnifiedRow, getCellSelection } from '../../tableState/cellSelectionState';
import { isEffectiveRawMode } from '../../tableState/sourceMode';
import type { TableContext } from '../../tableModel/tableContext';
import { prepareCellEntryTransaction } from '../activeCell/cellActivation';
import { getResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { getPendingOpenCellRequest, shouldSuppressNavigationKeys } from '../openCellRequest';
import { isBlankLineContent, REQUIRED_TABLE_BOUNDARY_BLANK_LINES } from '../tableBoundarySpacing';
import { resolveTableContextAtPos } from '../tableResolution';
import type { CellCoords } from '../../tableModel/types';
import type { InitialCursorPos } from '../../shared/cursorPlacement';

type DeletionDirection = 'backward' | 'forward';
type TableSide = 'before' | 'after';
type VerticalEntryDirection = 'up' | 'down';
type HorizontalEntryDirection = 'left' | 'right';
/** Which end of a grid axis an entry lands on. */
type GridEdge = 'first' | 'last';

interface EdgeCellTarget {
    row: GridEdge;
    col: GridEdge;
}

interface BoundaryEntryTarget {
    ctx: TableContext;
    side: TableSide;
}

/** An old-document range a deletion removes, and whether it also inserts. */
interface DeletedSpan {
    from: number;
    to: number;
    insertsText: boolean;
}

interface NewlineScan {
    count: number;
    edge: number;
}

// A rendered widget implies that table parsing has already completed. Keyboard
// entry must never block waiting for syntax work on the keyboard event path.
const TABLE_ENTRY_SYNTAX_TREE_TIMEOUT_MS = 0;

/**
 * Newlines between a table and its neighbouring text that a deletion may not consume:
 * the required blank lines plus the line break that ends the adjoining line.
 */
const PROTECTED_BOUNDARY_NEWLINES = REQUIRED_TABLE_BOUNDARY_BLANK_LINES + 1;

function canEnterRenderedTable(state: EditorState): boolean {
    return (
        !isEffectiveRawMode(state) &&
        !getCellSelection(state) &&
        !getActiveCell(state) &&
        !getPendingOpenCellRequest(state)
    );
}

/** Arrow entry reads one movement target off the main range, so it needs a lone caret. */
function canEnterFromArrowMovement(state: EditorState): boolean {
    return canEnterRenderedTable(state) && state.selection.ranges.length === 1 && state.selection.main.empty;
}

function getDeletionDirection(transaction: Transaction): DeletionDirection | null {
    if (transaction.isUserEvent('delete.backward')) {
        return 'backward';
    }

    if (transaction.isUserEvent('delete.forward')) {
        return 'forward';
    }

    return null;
}

/** Offset of the character a one-step deletion at `head` removes. */
function deletedCharOffset(head: number, direction: DeletionDirection): number {
    return direction === 'forward' ? head : head - 1;
}

function resolveSourceEdgeCellCoords(ctx: TableContext, edges: EdgeCellTarget): CellCoords | null {
    const rows = [ctx.cellRanges.headers, ...ctx.cellRanges.rows];
    const rowIndex = edges.row === 'first' ? 0 : rows.length - 1;
    const row = rows[rowIndex];
    if (!row?.length) {
        return null;
    }

    const colIndex = edges.col === 'first' ? 0 : row.length - 1;
    return fromUnifiedRow(rowIndex, colIndex);
}

/** Transaction opening a table's edge cell, or null when the table has no usable grid. */
function prepareEdgeCellEntry(
    state: EditorState,
    ctx: TableContext,
    edges: EdgeCellTarget,
    initialCursorPos: InitialCursorPos
): TransactionSpec | null {
    // Open requests must start from a source-backed cell. Normalization can make a
    // ragged table rectangular after activation, but it cannot resolve a synthetic
    // padded cell before that transaction has run.
    const coords = resolveSourceEdgeCellCoords(ctx, edges);
    return coords ? prepareCellEntryTransaction({ state, ctx, coords, initialCursorPos }) : null;
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
    if (head < resolved.tableFrom || head > resolved.tableTo) {
        return false;
    }

    return Boolean(transaction.changes.touchesRange(resolved.tableFrom, resolved.tableTo));
}

/** The table this range's deletion would reach, or null when it stays outside one. */
function resolveDeletionTargetTable(
    transaction: Transaction,
    range: SelectionRange,
    direction: DeletionDirection
): TableContext | null {
    // An explicit selection is a deliberate range deletion, a table-spanning one included.
    if (!range.empty) {
        return null;
    }

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

    return resolveTableContextAtPos(state, targetPos, TABLE_ENTRY_SYNTAX_TREE_TIMEOUT_MS);
}

/** Newlines before `pos`, crossing only blank-line whitespace and stopping at `limit`. */
function scanNewlinesBackward(state: EditorState, pos: number, limit: number): NewlineScan {
    let cursor = pos;
    let count = 0;
    let edge = pos;
    while (count < limit && cursor > 0) {
        const character = state.doc.sliceString(cursor - 1, cursor);
        if (character === '\n') {
            cursor--;
            edge = cursor;
            count++;
        } else if (isBlankLineContent(character)) {
            cursor--;
        } else {
            break;
        }
    }
    return { count, edge };
}

/** Newlines after `pos`, crossing only blank-line whitespace and stopping at `limit`. */
function scanNewlinesForward(state: EditorState, pos: number, limit: number): NewlineScan {
    let cursor = pos;
    let count = 0;
    let edge = pos;
    while (count < limit && cursor < state.doc.length) {
        const character = state.doc.sliceString(cursor, cursor + 1);
        if (character === '\n') {
            cursor++;
            edge = cursor;
            count++;
        } else if (isBlankLineContent(character)) {
            cursor++;
        } else {
            break;
        }
    }
    return { count, edge };
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

/**
 * The table that the newline span `[from, to)` separates from its neighbour, or null.
 *
 * A span between two tables separates both, so the table the deletion moves toward wins.
 */
function resolveAdjoiningTable(
    state: EditorState,
    from: number,
    to: number,
    direction: DeletionDirection
): BoundaryEntryTarget | null {
    const sides: TableSide[] = direction === 'backward' ? ['before', 'after'] : ['after', 'before'];
    for (const side of sides) {
        const boundary = side === 'before' ? from : to;
        const ctx = resolveTableContextAtPos(state, boundary, TABLE_ENTRY_SYNTAX_TREE_TIMEOUT_MS);
        if (ctx && (side === 'before' ? ctx.to === boundary : ctx.from === boundary)) {
            return { ctx, side };
        }
    }

    return null;
}

/** The newlines beside the table edge that a deletion moving away from it must leave in place. */
function resolveProtectedSeparator(state: EditorState, target: BoundaryEntryTarget): { from: number; to: number } {
    const { ctx, side } = target;
    return side === 'after'
        ? { from: scanNewlinesBackward(state, ctx.from, PROTECTED_BOUNDARY_NEWLINES).edge, to: ctx.from }
        : { from: ctx.to, to: scanNewlinesForward(state, ctx.to, PROTECTED_BOUNDARY_NEWLINES).edge };
}

/**
 * The table whose boundary separation this deletion would consume, or null.
 *
 * A table is kept clear of its neighbours by `REQUIRED_TABLE_BOUNDARY_BLANK_LINES`, and a
 * newline counts as part of that boundary in either of two ways:
 *
 * - it sits directly against a table edge, so removing it merges the neighbouring line into
 *   the table's own line and leaves the caret parked on the widget edge; or
 * - it belongs to a run no longer than `PROTECTED_BOUNDARY_NEWLINES`, so removing it drops
 *   the separation below the blank line the plugin would immediately restore.
 *
 * Deleting toward the table enters its edge cell; deleting away preserves the newline and
 * moves the caret. Surplus blank lines in the middle of a longer run are ordinary text and
 * still delete normally, one press at a time.
 */
function resolveBoundarySeparatorTable(
    transaction: Transaction,
    range: SelectionRange,
    direction: DeletionDirection
): BoundaryEntryTarget | null {
    if (!range.empty) {
        return null;
    }

    const state = transaction.startState;
    const deletedFrom = deletedCharOffset(range.head, direction);
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

    const edgeAdjacent = resolveAdjoiningTable(state, deletedFrom, deletedFrom + 1, direction);
    if (edgeAdjacent) {
        return edgeAdjacent;
    }

    const limit = PROTECTED_BOUNDARY_NEWLINES + 1;
    const backward = scanNewlinesBackward(state, range.head, limit);
    const forward = scanNewlinesForward(state, range.head, limit);
    if (backward.count + forward.count > PROTECTED_BOUNDARY_NEWLINES) {
        return null;
    }

    return resolveAdjoiningTable(state, backward.edge, forward.edge, direction);
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
    target: BoundaryEntryTarget
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
    const state = transaction.startState;
    const isBackward = direction === 'backward';
    const edges: EdgeCellTarget = isBackward ? { row: 'last', col: 'last' } : { row: 'first', col: 'first' };
    const deletionTarget = resolveDeletionTargetTable(transaction, range, direction);
    if (deletionTarget) {
        return prepareEdgeCellEntry(state, deletionTarget, edges, isBackward ? 'end' : 'start');
    }

    const boundaryTarget = resolveBoundarySeparatorTable(transaction, range, direction);
    if (!boundaryTarget) {
        return null;
    }

    if (boundaryTarget.side === (isBackward ? 'before' : 'after')) {
        return prepareEdgeCellEntry(state, boundaryTarget.ctx, edges, isBackward ? 'end' : 'start');
    }

    return prepareSeparatorPreservingDeletion(transaction, range, direction, boundaryTarget);
}

const tableBoundaryDeletionFilter = EditorState.transactionFilter.of((transaction) => {
    const direction = getDeletionDirection(transaction);
    if (!direction || !transaction.docChanged) {
        return transaction;
    }

    // Drop the deletion outright: the caret is already on its way into a cell.
    if (isDeletingIntoPendingOpenCell(transaction)) {
        return [];
    }

    if (!canEnterRenderedTable(transaction.startState)) {
        return transaction;
    }

    // Several carets can reach tables in one gesture. A deletion toward a table enters the
    // first in document order and drops the rest because a cell editor holds one caret. An
    // away-from-table caret move requires a lone caret; multi-range deletion passes through.
    for (const range of transaction.startState.selection.ranges) {
        const spec = prepareTableBoundaryDeletion(transaction, range, direction);
        if (spec) {
            return spec;
        }
    }

    return transaction;
});

function isPositionMovingInDirection(
    currentPos: number,
    targetPos: number,
    direction: VerticalEntryDirection
): boolean {
    return direction === 'down' ? targetPos > currentPos : targetPos < currentPos;
}

function entersTableFromExpectedSide(
    currentPos: number,
    ctx: TableContext,
    direction: VerticalEntryDirection
): boolean {
    return direction === 'down' ? currentPos < ctx.from : currentPos > ctx.to;
}

/** True when the movement left the caret's own line block rather than moving within a wrapped line. */
function leavesBlock(block: BlockInfo, targetPos: number, direction: VerticalEntryDirection): boolean {
    return direction === 'down' ? targetPos > block.to : targetPos < block.from;
}

/**
 * Resolves the table that a vertical movement stepped over without landing in.
 *
 * `moveVertically` works in screen coordinates, and CodeMirror deliberately scans past
 * block widgets while doing so: on hitting a non-text block it moves the probe to just
 * beyond that block and keeps looking for a real line. Rendered tables are block replace
 * decorations, so the returned target sits on the far side of the table rather than inside
 * it, and resolving the target position alone finds nothing.
 *
 * So ask the layout which block was skipped instead of searching the document for one that
 * fits. The block adjacent to the caret's own block, on the side being moved toward, is
 * exactly the block CodeMirror scanned past. Both lookups are height-map queries and the
 * table resolution is a point lookup, so this stays correct far down a long note where
 * enumerating every table would require a full-document parse.
 */
function resolveSkippedTableBlock(
    view: EditorView,
    currentPos: number,
    targetPos: number,
    direction: VerticalEntryDirection
): TableContext | null {
    const currentBlock = view.lineBlockAt(currentPos);
    if (!leavesBlock(currentBlock, targetPos, direction)) {
        return null;
    }

    const probePos = direction === 'down' ? currentBlock.to + 1 : currentBlock.from - 1;
    if (probePos < 0 || probePos > view.state.doc.length) {
        return null;
    }

    // A composite `type` means the line is split by block widgets, which a whole-line
    // table replacement never produces; treating it as "not a table" is the safe read.
    const skippedBlock = view.lineBlockAt(probePos);
    if (skippedBlock.type !== BlockType.WidgetRange) {
        return null;
    }

    return resolveTableContextAtPos(view.state, skippedBlock.from, TABLE_ENTRY_SYNTAX_TREE_TIMEOUT_MS);
}

/**
 * Resolve the table a vertical movement should enter: the one under the movement target,
 * or else the one the movement skipped over.
 */
function resolveVerticalEntryContext(
    view: EditorView,
    currentPos: number,
    targetPos: number,
    direction: VerticalEntryDirection
): TableContext | null {
    if (!isPositionMovingInDirection(currentPos, targetPos, direction)) {
        return null;
    }

    const directCtx = resolveTableContextAtPos(view.state, targetPos, TABLE_ENTRY_SYNTAX_TREE_TIMEOUT_MS);
    if (directCtx && entersTableFromExpectedSide(currentPos, directCtx, direction)) {
        return directCtx;
    }

    return resolveSkippedTableBlock(view, currentPos, targetPos, direction);
}

function activateTableAtVerticalTarget(view: EditorView, direction: VerticalEntryDirection): boolean {
    if (shouldSuppressNavigationKeys(view.state)) {
        return true;
    }

    if (!canEnterFromArrowMovement(view.state)) {
        return false;
    }

    const current = view.state.selection.main;
    const target = view.moveVertically(current, direction === 'down');
    if (target.head === current.head) {
        return false;
    }

    const ctx = resolveVerticalEntryContext(view, current.head, target.head, direction);
    if (!ctx) {
        return false;
    }

    const isDown = direction === 'down';
    const spec = prepareEdgeCellEntry(
        view.state,
        ctx,
        { row: isDown ? 'first' : 'last', col: 'first' },
        isDown ? 'start' : 'lastLineStart'
    );
    if (!spec) {
        return false;
    }

    view.dispatch(spec);
    return true;
}

function activateTableAtHorizontalTarget(view: EditorView, direction: HorizontalEntryDirection): boolean {
    if (shouldSuppressNavigationKeys(view.state)) {
        return true;
    }

    if (!canEnterFromArrowMovement(view.state)) {
        return false;
    }

    const current = view.state.selection.main;
    const lineIsLeftToRight = view.textDirectionAt(current.head) === Direction.LTR;
    const movesForward = direction === 'right' ? lineIsLeftToRight : !lineIsLeftToRight;
    const target = view.moveByChar(current, movesForward);
    if (target.head === current.head) {
        return false;
    }

    const ctx = resolveTableContextAtPos(view.state, target.head, TABLE_ENTRY_SYNTAX_TREE_TIMEOUT_MS);
    if (!ctx || (movesForward ? current.head >= ctx.from : current.head <= ctx.to)) {
        return false;
    }

    const spec = prepareEdgeCellEntry(
        view.state,
        ctx,
        movesForward ? { row: 'first', col: 'first' } : { row: 'last', col: 'last' },
        movesForward ? 'start' : 'end'
    );
    if (!spec) {
        return false;
    }

    view.dispatch(spec);
    return true;
}

/**
 * Arrow entry runs ahead of the main editor's own motion commands.
 *
 * Both handlers swallow the key while an entry request is in flight. The request settles a
 * frame or more after dispatch, and until the nested editor mounts and takes focus the main
 * editor still owns the keyboard with the caret parked in the table's replaced range, so key
 * repeat would otherwise walk it through the hidden Markdown. This mirrors the Tab/Enter
 * suppression in `openCellRequestKeymap` and the repeat-deletion guard in this module's
 * transaction filter.
 */
const tableArrowEntryKeymap = Prec.highest(
    keymap.of([
        {
            key: 'ArrowLeft',
            run: (view) => activateTableAtHorizontalTarget(view, 'left'),
        },
        {
            key: 'ArrowRight',
            run: (view) => activateTableAtHorizontalTarget(view, 'right'),
        },
        {
            key: 'ArrowUp',
            run: (view) => activateTableAtVerticalTarget(view, 'up'),
        },
        {
            key: 'ArrowDown',
            run: (view) => activateTableAtVerticalTarget(view, 'down'),
        },
    ])
);

export const mainEditorTableEntryExtension: Extension = [tableBoundaryDeletionFilter, tableArrowEntryKeymap];

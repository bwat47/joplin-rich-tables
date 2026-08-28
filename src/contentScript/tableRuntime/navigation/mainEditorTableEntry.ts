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
import { REQUIRED_TABLE_BOUNDARY_BLANK_LINES } from '../tableBoundarySpacing';
import { resolveTableContextAtPos } from '../tableResolution';
import type { CellCoords } from '../../tableModel/types';
import type { InitialCursorPos } from '../../shared/cursorPlacement';

type DeletionDirection = 'backward' | 'forward';
type VerticalEntryDirection = 'up' | 'down';
type HorizontalEntryDirection = 'left' | 'right';
/** Which end of a grid axis an entry lands on. */
type GridEdge = 'first' | 'last';

interface EdgeCellTarget {
    row: GridEdge;
    col: GridEdge;
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
 * A request settles a frame or more after it is dispatched - later still when the table has
 * to be normalized first. Until the nested editor mounts and takes focus, the main editor
 * owns the keyboard with the caret sitting in the table's replaced range, so a repeat
 * deletion would edit the hidden Markdown that this filter exists to protect. Deletions
 * elsewhere in the document are none of this filter's business, so they must still pass.
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

    // CodeMirror's deletion commands remove one contiguous range anchored at the caret, so
    // the character next to the caret is always part of it - including word- and line-wise
    // deletion, which stops at the line boundary and reaches the table on the following
    // press. Probing that one position identifies the table being deleted into without
    // walking the change set; `touchesRange` then confirms this transaction is that deletion.
    const targetPos = range.head + (direction === 'forward' ? 1 : -1);
    if (targetPos < 0 || targetPos > transaction.startState.doc.length) {
        return null;
    }
    if (!transaction.changes.touchesRange(targetPos)) {
        return null;
    }

    return resolveTableContextAtPos(transaction.startState, targetPos, TABLE_ENTRY_SYNTAX_TREE_TIMEOUT_MS);
}

/** Length of the run of newlines starting at `from` and extending in `direction`. */
function measureNewlineRun(state: EditorState, from: number, direction: DeletionDirection): number {
    const limit = PROTECTED_BOUNDARY_NEWLINES + 1;
    const text =
        direction === 'forward'
            ? state.doc.sliceString(from, Math.min(state.doc.length, from + limit))
            : state.doc.sliceString(Math.max(0, from - limit), from);
    let run = 0;
    while (run < text.length && text[direction === 'forward' ? run : text.length - 1 - run] === '\n') {
        run++;
    }
    return run;
}

/**
 * The table whose boundary separation this deletion would consume, or null.
 *
 * A table is kept clear of its neighbours by `REQUIRED_TABLE_BOUNDARY_BLANK_LINES`, and
 * entering a cell restores that spacing when it is missing. Deleting the last of those
 * newlines is therefore work the plugin immediately undoes, so the separator counts as
 * part of the table boundary and the deletion enters the edge cell instead. Surplus blank
 * lines are ordinary text and still delete normally, one press at a time.
 */
function resolveBoundarySeparatorTable(
    transaction: Transaction,
    range: SelectionRange,
    direction: DeletionDirection
): TableContext | null {
    if (!range.empty) {
        return null;
    }

    const state = transaction.startState;
    const runLength = measureNewlineRun(state, range.head, direction);
    if (runLength === 0 || runLength > PROTECTED_BOUNDARY_NEWLINES) {
        return null;
    }

    const isForward = direction === 'forward';
    const runFrom = isForward ? range.head : range.head - runLength;
    const runTo = isForward ? range.head + runLength : range.head;
    if (!transaction.changes.touchesRange(runFrom, runTo)) {
        return null;
    }

    // The run has to lead straight into the table, not merely toward one further away.
    const boundary = isForward ? runTo : runFrom;
    const ctx = resolveTableContextAtPos(state, boundary, TABLE_ENTRY_SYNTAX_TREE_TIMEOUT_MS);
    if (!ctx || (isForward ? ctx.from !== boundary : ctx.to !== boundary)) {
        return null;
    }

    return ctx;
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

    const isBackward = direction === 'backward';
    const edges: EdgeCellTarget = isBackward ? { row: 'last', col: 'last' } : { row: 'first', col: 'first' };

    // Several carets can reach tables in one gesture. Enter the first in document order and
    // drop the rest of the deletion: a cell editor holds one caret, so the entry transaction
    // collapses the other ranges regardless, and letting them through would edit the very
    // Markdown this filter protects.
    for (const range of transaction.startState.selection.ranges) {
        const ctx =
            resolveDeletionTargetTable(transaction, range, direction) ??
            resolveBoundarySeparatorTable(transaction, range, direction);
        if (!ctx) {
            continue;
        }

        const spec = prepareEdgeCellEntry(transaction.startState, ctx, edges, isBackward ? 'end' : 'start');
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

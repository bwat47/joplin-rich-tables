import { EditorState, Prec, type Extension, type Transaction } from '@codemirror/state';
import { BlockType, keymap, type BlockInfo, type EditorView } from '@codemirror/view';
import { getActiveCell } from '../../tableState/activeCellState';
import { fromUnifiedRow, getCellSelection } from '../../tableState/cellSelectionState';
import { isEffectiveRawMode } from '../../tableState/sourceMode';
import type { TableContext } from '../../tableModel/tableContext';
import { prepareCellEntryTransaction } from '../activeCell/cellActivation';
import { getResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { getPendingOpenCellRequest, type PreparedOpenCellRequestTransaction } from '../openCellRequest';
import { resolveTableContextAtPos } from '../tableResolution';
import type { CellCoords } from '../../tableModel/types';
import type { InitialCursorPos } from '../../shared/cursorPlacement';

type DeletionDirection = 'backward' | 'forward';
type VerticalEntryDirection = 'up' | 'down';
/** Which end of a grid axis an entry lands on. */
type GridEdge = 'first' | 'last';

interface EdgeCellTarget {
    row: GridEdge;
    col: GridEdge;
}

// A rendered widget implies that table parsing has already completed. Keyboard
// entry must never block waiting for syntax work on the keyboard event path.
const TABLE_ENTRY_SYNTAX_TREE_TIMEOUT_MS = 0;

function canEnterRenderedTable(state: EditorState): boolean {
    return (
        !isEffectiveRawMode(state) &&
        state.selection.ranges.length === 1 &&
        state.selection.main.empty &&
        !getCellSelection(state) &&
        !getActiveCell(state) &&
        !getPendingOpenCellRequest(state)
    );
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
    ctx: TableContext,
    edges: EdgeCellTarget,
    initialCursorPos: InitialCursorPos
): PreparedOpenCellRequestTransaction | null {
    // Open requests must start from a source-backed cell. Normalization can make a
    // ragged table rectangular after activation, but it cannot resolve a synthetic
    // padded cell before that transaction has run.
    const coords = resolveSourceEdgeCellCoords(ctx, edges);
    return coords ? prepareCellEntryTransaction({ ctx, coords, initialCursorPos }) : null;
}

/**
 * True while an open-cell request is still in flight with the caret parked inside its table.
 *
 * A request settles a frame or more after it is dispatched - later still when the table has
 * to be normalized first. Until the nested editor mounts and takes focus, the main editor
 * owns the keyboard with the caret sitting in the table's replaced range, so a repeat
 * deletion would edit the hidden Markdown that this filter exists to protect.
 */
function isDeletingIntoPendingOpenCell(state: EditorState): boolean {
    if (isEffectiveRawMode(state) || !getPendingOpenCellRequest(state)) {
        return false;
    }

    const resolved = getResolvedActiveCell(state);
    if (!resolved) {
        return false;
    }

    const { head } = state.selection.main;
    return head >= resolved.tableFrom && head <= resolved.tableTo;
}

const tableBoundaryDeletionFilter = EditorState.transactionFilter.of((transaction) => {
    const direction = getDeletionDirection(transaction);
    if (!direction || !transaction.docChanged) {
        return transaction;
    }

    // Drop the deletion outright: the caret is already on its way into a cell.
    if (isDeletingIntoPendingOpenCell(transaction.startState)) {
        return [];
    }

    if (!canEnterRenderedTable(transaction.startState)) {
        return transaction;
    }

    // CodeMirror's deletion commands remove one contiguous range anchored at the caret, so
    // the character next to the caret is always part of it - including word- and line-wise
    // deletion, which stops at the line boundary and reaches the table on the following
    // press. Probing that one position identifies the table being deleted into without
    // walking the change set; `touchesRange` then confirms this transaction is that deletion.
    const current = transaction.startState.selection.main;
    const targetPos = current.head + (direction === 'forward' ? 1 : -1);
    if (targetPos < 0 || targetPos > transaction.startState.doc.length) {
        return transaction;
    }
    if (!transaction.changes.touchesRange(targetPos)) {
        return transaction;
    }

    const ctx = resolveTableContextAtPos(transaction.startState, targetPos, TABLE_ENTRY_SYNTAX_TREE_TIMEOUT_MS);
    if (!ctx) {
        return transaction;
    }

    const isBackward = direction === 'backward';
    const edges: EdgeCellTarget = isBackward ? { row: 'last', col: 'last' } : { row: 'first', col: 'first' };

    return prepareEdgeCellEntry(ctx, edges, isBackward ? 'end' : 'start') ?? transaction;
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
    if (!canEnterRenderedTable(view.state)) {
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

const tableVerticalEntryKeymap = Prec.highest(
    keymap.of([
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

export const mainEditorTableEntryExtension: Extension = [tableBoundaryDeletionFilter, tableVerticalEntryKeymap];

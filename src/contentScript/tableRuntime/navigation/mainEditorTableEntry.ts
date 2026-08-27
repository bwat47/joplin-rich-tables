import { EditorState, Prec, type Extension, type Transaction } from '@codemirror/state';
import { BlockType, keymap, type BlockInfo, type EditorView } from '@codemirror/view';
import { getActiveCell } from '../../tableState/activeCellState';
import { fromUnifiedRow, getCellSelection } from '../../tableState/cellSelectionState';
import { isEffectiveRawMode } from '../../tableState/sourceMode';
import { getTableGridBounds, type TableContext } from '../../tableModel/tableContext';
import { activateTableCell } from '../activeCell/cellActivation';
import { createResolvedActiveCell, getResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { getPendingOpenCellRequest, prepareOpenCellRequestTransaction } from '../openCellRequest';
import { resolveTableContextAtPos } from '../tableResolution';

type DeletionDirection = 'backward' | 'forward';
type VerticalEntryDirection = 'up' | 'down';

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

    const bounds = getTableGridBounds(ctx);
    if (bounds.totalRows <= 0 || bounds.totalCols <= 0) {
        return transaction;
    }

    const isBackward = direction === 'backward';
    const targetCoords = fromUnifiedRow(isBackward ? bounds.totalRows - 1 : 0, isBackward ? bounds.totalCols - 1 : 0);
    const resolvedCell = createResolvedActiveCell({ ctx, coords: targetCoords });
    if (!resolvedCell) {
        return transaction;
    }

    return prepareOpenCellRequestTransaction({
        target: { resolvedCell },
        initialCursorPos: isBackward ? 'end' : 'start',
    });
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

    const bounds = getTableGridBounds(ctx);
    if (bounds.totalRows <= 0 || bounds.totalCols <= 0) {
        return false;
    }

    const targetCoords = fromUnifiedRow(direction === 'down' ? 0 : bounds.totalRows - 1, 0);
    return activateTableCell(view, ctx.from, targetCoords, {
        initialCursorPos: direction === 'down' ? 'start' : 'lastLineStart',
    });
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

import { Prec, type EditorState, type Extension } from '@codemirror/state';
import { Direction, keymap, type BlockInfo, type EditorView } from '@codemirror/view';

import type { TableContext } from '../../tableModel/tableContext';
import { shouldSuppressNavigationKeys } from '../../tableState/openCellRequestState';
import { getTableContextAtPos } from '../../tableState/tableContextField';
import { prepareEdgeCellEntry } from '../cellActivation';
import { hasPlainRenderedTableCaret } from '../renderedTableCaret';

type VerticalEntryDirection = 'up' | 'down';
type HorizontalEntryDirection = 'left' | 'right';

/** Arrow entry reads one movement target off the main range, so it needs a lone caret. */
function canEnterFromArrowMovement(state: EditorState): boolean {
    return hasPlainRenderedTableCaret(state) && state.selection.ranges.length === 1 && state.selection.main.empty;
}

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
 * The line next to the caret's own block, on the side being moved toward, is where that
 * skipped block starts or ends, so the table whose edge sits there is the one scanned past.
 * Every table in the index is rendered as a widget while arrow-key entry is available, which
 * excludes raw mode, so the index alone identifies it. The caret's block still comes from the
 * layout so movement within a wrapped line is not mistaken for leaving it.
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

    // A probe past either document edge finds no table.
    const probePos = direction === 'down' ? currentBlock.to + 1 : currentBlock.from - 1;
    return getTableContextAtPos(view.state, probePos);
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

    const directCtx = getTableContextAtPos(view.state, targetPos);
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
    view.dispatch(
        prepareEdgeCellEntry(
            view.state,
            ctx,
            { row: isDown ? 'first' : 'last', col: 'first' },
            isDown ? 'start' : 'lastLineStart'
        )
    );
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

    const ctx = getTableContextAtPos(view.state, target.head);
    if (!ctx || (movesForward ? current.head >= ctx.from : current.head <= ctx.to)) {
        return false;
    }

    view.dispatch(
        prepareEdgeCellEntry(
            view.state,
            ctx,
            movesForward ? { row: 'first', col: 'first' } : { row: 'last', col: 'last' },
            movesForward ? 'start' : 'end'
        )
    );
    return true;
}

/**
 * Arrow entry runs ahead of the main editor's own motion commands.
 *
 * Both handlers swallow the key while an entry request is in flight. The request settles a
 * frame or more after dispatch, and until the nested editor mounts and takes focus the main
 * editor still owns the keyboard with the caret parked in the table's replaced range, so key
 * repeat would otherwise walk it through the hidden Markdown. This mirrors the Tab/Enter
 * suppression in `openCellRequestKeymap` and the repeat-deletion guard in
 * `tableBoundaryDeletion`.
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

export const mainEditorTableEntryExtension: Extension = tableArrowEntryKeymap;

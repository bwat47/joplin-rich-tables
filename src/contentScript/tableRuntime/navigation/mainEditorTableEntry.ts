import { EditorState, Prec, type Extension } from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';
import { getActiveCell } from '../../tableState/activeCellState';
import { fromUnifiedRow, getCellSelection } from '../../tableState/cellSelectionState';
import { isEffectiveRawMode } from '../../tableState/sourceMode';
import { buildTableContext, getTableGridBounds, type TableContext } from '../../tableModel/tableContext';
import { activateTableCell } from '../activeCell/cellActivation';
import { getPendingOpenCellRequest } from '../openCellRequest';
import { findTableRanges, resolveTableContextAtPos } from '../tableResolution';
import { selectWholeTable, type WholeTableSelectionFocus } from '../selection/cellSelectionController';

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

function focusEdgeForDirection(direction: DeletionDirection): WholeTableSelectionFocus {
    return direction === 'backward' ? 'end' : 'start';
}

function selectTableAtCharacterTarget(view: EditorView, direction: DeletionDirection): boolean {
    if (!canEnterRenderedTable(view.state)) {
        return false;
    }

    const current = view.state.selection.main;
    const target = view.moveByChar(current, direction === 'forward');
    if (target.head === current.head) {
        return false;
    }

    const ctx = resolveTableContextAtPos(view.state, target.head, TABLE_ENTRY_SYNTAX_TREE_TIMEOUT_MS);
    if (!ctx) {
        return false;
    }

    return selectWholeTable(view, ctx, focusEdgeForDirection(direction));
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

/**
 * CodeMirror may place a vertical movement target on either side of a block
 * replacement instead of inside its document range. Resolve the direct target
 * first, then fall back to the nearest table fully crossed by the movement.
 */
function resolveVerticalEntryContext(
    state: EditorState,
    currentPos: number,
    targetPos: number,
    direction: VerticalEntryDirection
): TableContext | null {
    if (!isPositionMovingInDirection(currentPos, targetPos, direction)) {
        return null;
    }

    const directCtx = resolveTableContextAtPos(state, targetPos, TABLE_ENTRY_SYNTAX_TREE_TIMEOUT_MS);
    if (directCtx && entersTableFromExpectedSide(currentPos, directCtx, direction)) {
        return directCtx;
    }

    const tables = findTableRanges(state, TABLE_ENTRY_SYNTAX_TREE_TIMEOUT_MS);
    if (!tables) {
        return null;
    }

    if (direction === 'down') {
        const crossed = tables.find((table) => currentPos < table.from && targetPos > table.to);
        return crossed ? buildTableContext(crossed) : null;
    }

    for (let index = tables.length - 1; index >= 0; index--) {
        const table = tables[index];
        if (currentPos > table.to && targetPos < table.from) {
            return buildTableContext(table);
        }
    }

    return null;
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

    const ctx = resolveVerticalEntryContext(view.state, current.head, target.head, direction);
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

const tableEntryKeymap = Prec.highest(
    keymap.of([
        {
            key: 'Backspace',
            run: (view) => selectTableAtCharacterTarget(view, 'backward'),
        },
        {
            key: 'Delete',
            run: (view) => selectTableAtCharacterTarget(view, 'forward'),
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

export const mainEditorTableEntryExtension: Extension = tableEntryKeymap;

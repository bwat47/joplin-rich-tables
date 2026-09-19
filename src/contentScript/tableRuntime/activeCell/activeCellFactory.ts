import type { SerializedTable } from '../../tableModel/MarkdownTable';
import {
    clampCellToRanges,
    computeCellAnchorForTable,
    type TargetCell,
    type TableCellAnchor,
} from '../../tableModel/cellAnchors';
import type { ActiveCell } from '../../tableState/activeCellState';
import type { TableContext } from '../../tableModel/tableContext';
import { toResolvedActiveCell, type ResolvedActiveCell } from './resolvedActiveCell';

export interface ActiveCellSelectionTarget {
    activeCell: ActiveCell;
    selectionAnchor: number;
}

function toActiveCellSelectionTarget(tableFrom: number, anchor: TableCellAnchor): ActiveCellSelectionTarget {
    return {
        activeCell: {
            tableFrom,
            section: anchor.section,
            row: anchor.row,
            col: anchor.col,
        },
        selectionAnchor: tableFrom + anchor.anchorOffset,
    };
}

export function createActiveCellForTable(params: {
    tableFrom: number;
    serialized: SerializedTable;
    target: TargetCell;
}): ActiveCellSelectionTarget | null {
    const anchor = computeCellAnchorForTable({
        serialized: params.serialized,
        target: params.target,
    });
    return anchor ? toActiveCellSelectionTarget(params.tableFrom, anchor) : null;
}

/**
 * Resolves `target` against `ctx`, clamping coordinates the table does not have.
 *
 * Entry points that derive a target from user intent - a click, a selection focus - can
 * name a cell a ragged row is missing, and clamping lands them on the nearest real one.
 * Cell identity read back from editor state must never be clamped: `createResolvedActiveCell`
 * returning null is how the lifecycle learns that an active cell no longer exists.
 */
export function resolveClampedCell(params: { ctx: TableContext; target: TargetCell }): ResolvedActiveCell {
    const { coords, range } = clampCellToRanges(params.ctx.cellRanges, params.target);
    return toResolvedActiveCell({ ctx: params.ctx, coords, range });
}

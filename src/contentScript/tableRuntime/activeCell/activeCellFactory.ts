import type { TableCellRanges } from '../../tableModel/markdownTableCellRanges';
import {
    computeCellAnchorForTableText,
    computeCellAnchorFromRanges,
    type TargetCell,
    type TableCellAnchor,
} from '../../tableModel/activeCellForTableText';
import type { ActiveCell } from '../../tableState/activeCellState';
import type { TableContext } from '../../tableModel/tableContext';
import { createResolvedActiveCell, type ResolvedActiveCell } from './resolvedActiveCell';

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

function createActiveCellFromRanges(params: {
    tableFrom: number;
    ranges: TableCellRanges;
    target: TargetCell;
}): ActiveCellSelectionTarget | null {
    const anchor = computeCellAnchorFromRanges({
        ranges: params.ranges,
        target: params.target,
    });
    return anchor ? toActiveCellSelectionTarget(params.tableFrom, anchor) : null;
}

export function createActiveCellForTableText(params: {
    tableFrom: number;
    tableText: string;
    target: TargetCell;
}): ActiveCellSelectionTarget | null {
    const anchor = computeCellAnchorForTableText({
        tableText: params.tableText,
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
export function resolveClampedCell(params: { ctx: TableContext; target: TargetCell }): ResolvedActiveCell | null {
    const clamped = createActiveCellFromRanges({
        tableFrom: params.ctx.from,
        ranges: params.ctx.cellRanges,
        target: params.target,
    });
    return clamped ? createResolvedActiveCell({ ctx: params.ctx, coords: clamped.activeCell }) : null;
}

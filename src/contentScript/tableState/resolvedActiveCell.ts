import type { EditorState } from '@codemirror/state';
import { clampCellToRanges } from '../tableModel/cellAnchors';
import { getActiveCell, type ActiveCell } from './activeCellState';
import { getTableContextStartingAt } from './tableContextField';
import type { TableContext } from '../tableModel/tableContext';
import { normalizeCellCoords, type CellCoords } from '../tableModel/types';
import { getCellRange, type CellRange } from '../tableModel/markdownTableCellRanges';

export interface ResolvedActiveCell {
    activeCell: ActiveCell;
    ctx: TableContext;
    contentFrom: number;
    contentTo: number;
    editableFrom: number;
    editableTo: number;
}

export type CellContentRange = Pick<ResolvedActiveCell, 'contentFrom' | 'contentTo'>;

/** Builds a resolved cell from coordinates already known to name `range` in `ctx`. */
export function toResolvedActiveCell(params: {
    ctx: TableContext;
    coords: CellCoords;
    range: CellRange;
}): ResolvedActiveCell {
    const { ctx, coords, range } = params;
    return {
        activeCell: {
            tableFrom: ctx.from,
            ...normalizeCellCoords(coords),
        },
        ctx,
        contentFrom: ctx.from + range.from,
        contentTo: ctx.from + range.to,
        editableFrom: ctx.from + range.editableFrom,
        editableTo: ctx.from + range.editableTo,
    };
}

/**
 * Resolves `target` against `ctx`, clamping coordinates the table does not have.
 *
 * Entry points that derive a target from user intent - a click, a selection focus, a
 * navigation step - can name a cell a ragged row is missing, and clamping lands them on
 * the nearest real one.
 * Cell identity read back from editor state must never be clamped: `createResolvedActiveCell`
 * returning null is how the lifecycle learns that an active cell no longer exists.
 */
export function resolveClampedCell(params: { ctx: TableContext; target: CellCoords }): ResolvedActiveCell {
    const { coords, range } = clampCellToRanges(params.ctx.cellRanges, params.target);
    return toResolvedActiveCell({ ctx: params.ctx, coords, range });
}

export function createResolvedActiveCell(params: { ctx: TableContext; coords: CellCoords }): ResolvedActiveCell | null {
    const range = getCellRange(params.ctx.cellRanges, params.coords);
    return range ? toResolvedActiveCell({ ...params, range }) : null;
}

/**
 * Resolves the active cell against the table starting at its anchor. An anchor that no longer
 * points at a table start does not resolve, so every resolved cell's identity matches its
 * table; lifecycle policy repositions or clears the stale cell.
 */
export function resolveActiveCell(state: EditorState, activeCell: ActiveCell | null): ResolvedActiveCell | null {
    if (!activeCell) {
        return null;
    }

    const ctx = getTableContextStartingAt(state, activeCell.tableFrom);
    if (!ctx) {
        return null;
    }

    return createResolvedActiveCell({
        ctx,
        coords: activeCell,
    });
}

export function getResolvedActiveCell(state: EditorState): ResolvedActiveCell | null {
    return resolveActiveCell(state, getActiveCell(state));
}

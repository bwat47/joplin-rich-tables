import type { EditorState } from '@codemirror/state';
import { resolveTableForActiveCell } from '../tablePositioning';
import type { ActiveCell } from '../../tableState/activeCellState';
import type { TableContext } from '../../tableModel/tableContext';
import { resolveCellDocRange } from '../tablePositioning';
import type { CellCoords } from '../../tableModel/types';

export interface ResolvedActiveCell {
    activeCell: ActiveCell;
    ctx: TableContext;
    tableFrom: number;
    tableTo: number;
    contentFrom: number;
    contentTo: number;
    editableFrom: number;
    editableTo: number;
}

export function createResolvedActiveCell(params: { ctx: TableContext; coords: CellCoords }): ResolvedActiveCell | null {
    const { ctx, coords } = params;
    const range = resolveCellDocRange({
        tableFrom: ctx.from,
        ranges: ctx.cellRanges,
        coords,
    });
    if (!range) {
        return null;
    }

    return {
        activeCell: {
            tableFrom: ctx.from,
            section: coords.section,
            row: coords.section === 'header' ? 0 : coords.row,
            col: coords.col,
        },
        ctx,
        tableFrom: ctx.from,
        tableTo: ctx.to,
        contentFrom: range.contentFrom,
        contentTo: range.contentTo,
        editableFrom: range.editableFrom,
        editableTo: range.editableTo,
    };
}

export function retargetResolvedActiveCell(
    resolved: ResolvedActiveCell,
    coords: CellCoords
): ResolvedActiveCell | null {
    return createResolvedActiveCell({
        ctx: resolved.ctx,
        coords,
    });
}

export function resolveActiveCell(state: EditorState, activeCell: ActiveCell | null): ResolvedActiveCell | null {
    if (!activeCell) {
        return null;
    }

    const resolved = resolveTableForActiveCell(state, activeCell);
    if (!resolved) {
        return null;
    }

    return createResolvedActiveCell({
        ctx: resolved.ctx,
        coords: {
            section: activeCell.section,
            row: activeCell.row,
            col: activeCell.col,
        },
    });
}

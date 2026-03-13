import type { EditorState } from '@codemirror/state';
import { resolveCellDocRange, resolveTableContextAtPos } from './tablePositioning';
import { getActiveCell, type ActiveCell } from './activeCellState';
import type { TableContext } from '../tableModel/tableContext';

export interface ResolvedActiveCell {
    activeCell: ActiveCell;
    ctx: TableContext;
    tableFrom: number;
    tableTo: number;
    cellFrom: number;
    cellTo: number;
}

export function resolveActiveCell(state: EditorState, activeCell: ActiveCell | null): ResolvedActiveCell | null {
    if (!activeCell) {
        return null;
    }

    const lookupPos = Math.min(activeCell.tableFrom + 1, state.doc.length);
    const ctx = resolveTableContextAtPos(state, lookupPos);
    if (!ctx || ctx.from !== activeCell.tableFrom) {
        return null;
    }

    const range = resolveCellDocRange({
        tableFrom: ctx.from,
        ranges: ctx.cellRanges,
        coords: activeCell,
    });
    if (!range) {
        return null;
    }

    return {
        activeCell,
        ctx,
        tableFrom: ctx.from,
        tableTo: ctx.to,
        cellFrom: range.cellFrom,
        cellTo: range.cellTo,
    };
}

export function resolveCurrentActiveCell(state: EditorState): ResolvedActiveCell | null {
    return resolveActiveCell(state, getActiveCell(state));
}

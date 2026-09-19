import type { EditorState } from '@codemirror/state';
import { getActiveCell, type ActiveCell } from '../../tableState/activeCellState';
import { getTableContextAtPos } from '../../tableState/tableContextField';
import type { TableContext } from '../../tableModel/tableContext';
import type { CellCoords } from '../../tableModel/types';
import { getCellDocRange } from '../../tableModel/markdownTableCellRanges';

export interface ResolvedActiveCell {
    activeCell: ActiveCell;
    ctx: TableContext;
    contentFrom: number;
    contentTo: number;
    editableFrom: number;
    editableTo: number;
}

export function createResolvedActiveCell(params: { ctx: TableContext; coords: CellCoords }): ResolvedActiveCell | null {
    const { ctx, coords } = params;
    const range = getCellDocRange({
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
        contentFrom: range.contentFrom,
        contentTo: range.contentTo,
        editableFrom: range.editableFrom,
        editableTo: range.editableTo,
    };
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

    const ctx = getTableContextAtPos(state, activeCell.tableFrom);
    if (!ctx || ctx.from !== activeCell.tableFrom) {
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

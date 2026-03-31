import type { EditorState } from '@codemirror/state';
import { resolveTableForActiveCell } from '../tablePositioning';
import type { ActiveCell } from '../../tableState/activeCellState';
import type { TableContext } from '../../tableModel/tableContext';

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

export function resolveActiveCell(state: EditorState, activeCell: ActiveCell | null): ResolvedActiveCell | null {
    if (!activeCell) {
        return null;
    }

    const resolved = resolveTableForActiveCell(state, activeCell);
    if (!resolved) {
        return null;
    }

    return {
        activeCell: {
            ...activeCell,
            tableFrom: resolved.tableFrom,
        },
        ctx: resolved.ctx,
        tableFrom: resolved.tableFrom,
        tableTo: resolved.tableTo,
        contentFrom: resolved.contentFrom,
        contentTo: resolved.contentTo,
        editableFrom: resolved.editableFrom,
        editableTo: resolved.editableTo,
    };
}

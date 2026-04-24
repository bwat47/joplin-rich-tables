import type { EditorState } from '@codemirror/state';
import { StateField } from '@codemirror/state';
import { activeCellField, getActiveCell, type ActiveCell } from '../../tableState/activeCellState';
import type { TableContext } from '../../tableModel/tableContext';
import type { CellCoords } from '../../tableModel/types';
import { resolveCellDocRange, resolveTableForActiveCell } from '../tablePositioning';

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

/**
 * Caches the resolved active cell per EditorState so transaction filters,
 * lifecycle handling, and decoration policy can share one resolution result
 * instead of each re-running table lookup and cell range derivation.
 */
export const resolvedActiveCellField = StateField.define<ResolvedActiveCell | null>({
    create(state) {
        return resolveActiveCell(state, getActiveCell(state));
    },
    update(value, tr) {
        // Re-derive when doc or active cell identity changes.
        if (!tr.docChanged) {
            // Use the false flag so states without activeCellField (e.g. nested editor
            // states, autocomplete states) return undefined instead of throwing.
            if (tr.startState.field(activeCellField, false) === tr.state.field(activeCellField, false)) {
                return value;
            }
        }
        return resolveActiveCell(tr.state, getActiveCell(tr.state));
    },
});

/**
 * Returns the resolved active cell for `state`.
 *
 * When `resolvedActiveCellField` is registered (production), this is a free cached read.
 * Falls back to a fresh computation for states that do not include the field (e.g. isolated
 * test states), so callers remain correct without needing to register the field everywhere.
 */
export function getResolvedActiveCell(state: EditorState): ResolvedActiveCell | null {
    const cached = state.field(resolvedActiveCellField, false);
    if (cached !== undefined) {
        return cached;
    }
    return resolveActiveCell(state, getActiveCell(state));
}

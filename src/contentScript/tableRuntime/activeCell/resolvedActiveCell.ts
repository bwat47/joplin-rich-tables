import type { EditorState } from '@codemirror/state';
import { StateField } from '@codemirror/state';
import { activeCellField, getActiveCell, type ActiveCell } from '../../tableState/activeCellState';
import type { TableContext } from '../../tableModel/tableContext';
import type { CellCoords } from '../../tableModel/types';
import { resolveCellDocRange, resolveTableContextAtPos } from '../tableResolution';

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

export function resolveCellWithinResolvedTable(
    resolved: ResolvedActiveCell,
    coords: CellCoords
): ResolvedActiveCell | null {
    return createResolvedActiveCell({
        ctx: resolved.ctx,
        coords,
    });
}

/**
 * An anchor outside the document cannot identify a table. Rejecting it outright keeps
 * resolution honest: clamping such an anchor to a document edge would resolve it against
 * whatever happens to sit there, yielding a confident answer for an anchor we know is bad.
 *
 * Note this only covers anchors outside the document. An in-range anchor that no longer
 * points at a table start still resolves to the table containing it, which nested-editor
 * sessions rely on to recover from document drift.
 */
function resolveAnchoredActiveCell(state: EditorState, activeCell: ActiveCell): ResolvedActiveCell | null {
    if (activeCell.tableFrom < 0 || activeCell.tableFrom > state.doc.length) {
        return null;
    }

    const ctx = resolveTableContextAtPos(state, activeCell.tableFrom);
    if (!ctx) {
        return null;
    }

    return createResolvedActiveCell({
        ctx,
        coords: activeCell,
    });
}

export function resolveActiveCell(state: EditorState, activeCell: ActiveCell | null): ResolvedActiveCell | null {
    if (!activeCell) {
        return null;
    }

    return resolveAnchoredActiveCell(state, activeCell);
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
        // Use the false flag so states without activeCellField (e.g. nested editor
        // states, autocomplete states) return undefined instead of throwing.
        if (!tr.docChanged && tr.startState.field(activeCellField, false) === tr.state.field(activeCellField, false)) {
            return value;
        }
        return resolveActiveCell(tr.state, getActiveCell(tr.state));
    },
});

/**
 * Returns the resolved active cell for `state`.
 *
 * When `resolvedActiveCellField` is registered, this is a cached read.
 * Falls back to a fresh computation for states that do not include the field
 * (for example isolated test states or other partial editor states), so
 * callers remain correct without needing to register the field everywhere.
 */
export function getResolvedActiveCell(state: EditorState): ResolvedActiveCell | null {
    const cached = state.field(resolvedActiveCellField, false);
    if (cached !== undefined) {
        return cached;
    }
    return resolveActiveCell(state, getActiveCell(state));
}

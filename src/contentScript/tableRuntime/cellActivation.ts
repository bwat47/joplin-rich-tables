/**
 * Shared cell activation logic for activating table cells and opening nested editors.
 */
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import { findCellForPos } from '../tableModel/markdownTableCellRanges';
import type { TableContext } from '../tableModel/tableContext';
import { fromUnifiedRow } from '../tableModel/types';
import { clearActiveCellEffect, getActiveCell, type ActiveCell } from '../tableState/activeCellState';
import type { InitialCursorPos } from '../tableState/cursorPlacement';
import { resolveClampedCell, toResolvedActiveCell, type ResolvedActiveCell } from '../tableState/resolvedActiveCell';
import { isEffectiveRawMode } from '../tableState/sourceMode';
import { getTableContextAtPos } from '../tableState/tableContextField';
import {
    prepareOpenCellRequestTransaction,
    requestOpenCell,
    type CellEntryMode,
    type PreparedOpenCellRequestTransaction,
} from './openCellRequest';

export interface ActivateCellOptions {
    /** If true and position is outside any table, clears active cell and focuses main editor (default: false) */
    clearIfOutside?: boolean;
    /** How far this entry may go (default `repair`). */
    entryMode?: CellEntryMode;
    /** Optional fallback identity used when the cursor lands on table structure during lifecycle-driven reactivation */
    preferredActiveCell?: ActiveCell | null;
}

export function resolveActivationTargetCell(params: {
    tableFrom: number;
    relativePos: number;
    cellRanges: Parameters<typeof findCellForPos>[0];
    activeCell: ReturnType<typeof getActiveCell>;
}): { section: 'header' | 'body'; row: number; col: number } {
    const targetCell = findCellForPos(params.cellRanges, params.relativePos);
    if (targetCell) {
        return targetCell;
    }

    if (params.activeCell && params.activeCell.tableFrom === params.tableFrom) {
        return {
            section: params.activeCell.section,
            row: params.activeCell.row,
            col: params.activeCell.col,
        };
    }

    return { section: 'body', row: 0, col: 0 };
}

/**
 * Activates the cell at the given document position, opening the nested editor.
 * @returns true if a cell was activated, false otherwise
 */
export function activateCellAtPosition(view: EditorView, pos: number, options?: ActivateCellOptions): boolean {
    // Raw mode (source mode or search) renders no widgets, so there is no cell to activate.
    // The table index still reports raw tables, so this check is what keeps activation out.
    if (isEffectiveRawMode(view.state)) {
        return false;
    }

    const ctx = getTableContextAtPos(view.state, pos);

    if (!ctx) {
        // Position is outside any table
        if (options?.clearIfOutside) {
            view.dispatch({
                effects: clearActiveCellEffect.of(null),
                selection: { anchor: pos },
                scrollIntoView: true,
            });
            view.focus();
        }
        return false;
    }

    // Find which cell contains the position
    const relativePos = pos - ctx.from;

    // Cursor restoration during undo/redo can land on table punctuation or padding.
    // Preserve the current logical cell in that case instead of arbitrarily snapping to (0,0).
    const targetCell = resolveActivationTargetCell({
        tableFrom: ctx.from,
        relativePos,
        cellRanges: ctx.cellRanges,
        activeCell: options?.preferredActiveCell ?? getActiveCell(view.state),
    });

    requestOpenCell(view, {
        resolvedCell: resolveClampedCell({ ctx, target: targetCell }),
        entryMode: options?.entryMode,
    });

    return true;
}

/** Which end of a grid axis an entry lands on. */
type GridEdge = 'first' | 'last';

/** The corner cell an entry from outside the table lands on. */
export interface EdgeCellTarget {
    row: GridEdge;
    col: GridEdge;
}

/**
 * Resolves the edge cell from the table's own source rows. Every indexed table has a header
 * row and every row has at least one cell, so the edge always names a real cell.
 */
function resolveSourceEdgeCell(ctx: TableContext, edges: EdgeCellTarget): ResolvedActiveCell {
    const rows = [ctx.cellRanges.headers, ...ctx.cellRanges.rows];
    const rowIndex = edges.row === 'first' ? 0 : rows.length - 1;
    // Parsed tables always have a header and at least one source cell in each row.
    const row = rows[rowIndex]!;
    const colIndex = edges.col === 'first' ? 0 : row.length - 1;

    return toResolvedActiveCell({ ctx, coords: fromUnifiedRow(rowIndex, colIndex), range: row[colIndex]! });
}

/**
 * Transaction opening a table's edge cell, for entry from outside the table.
 *
 * Returns a spec rather than dispatching because the boundary-deletion transaction filter
 * can only return a spec; arrow-key entry dispatches the same spec.
 *
 * The request suppresses navigation keys: until the nested editor mounts and takes focus,
 * the main editor still owns the keyboard with the caret parked in the table's replaced
 * range, so key repeat would otherwise walk it through the hidden Markdown.
 *
 * Any normalization the table needs is folded into this same transaction, so the whole
 * entry is one document change dispatched from the event that asked for it.
 */
export function prepareEdgeCellEntry(
    state: EditorState,
    ctx: TableContext,
    edges: EdgeCellTarget,
    initialCursorPos: InitialCursorPos
): PreparedOpenCellRequestTransaction {
    // Open requests must start from a source-backed cell. Normalization can make a
    // ragged table rectangular after activation, but it cannot resolve a synthetic
    // padded cell before that transaction has run.
    return prepareOpenCellRequestTransaction({
        state,
        resolvedCell: resolveSourceEdgeCell(ctx, edges),
        initialCursorPos,
        suppressKeys: true,
    });
}

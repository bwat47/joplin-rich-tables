/**
 * Shared cell activation logic for activating table cells and opening nested editors.
 */
import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { clearActiveCellEffect, getActiveCell, type ActiveCell } from '../../tableState/activeCellState';
import { getTableContextAtPos } from '../../tableState/tableContextField';
import { isEffectiveRawMode } from '../../tableState/sourceMode';
import { findCellForPos } from '../../tableModel/markdownTableCellRanges';
import { resolveClampedCell } from './activeCellFactory';
import type { ResolvedActiveCell } from './resolvedActiveCell';
import {
    prepareOpenCellRequestTransaction,
    requestOpenCell,
    type CellEntryMode,
    type PreparedOpenCellRequestTransaction,
} from '../openCellRequest';
import type { InitialCursorPos } from '../../shared/cursorPlacement';

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
                effects: clearActiveCellEffect.of(undefined),
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

/**
 * Builds the transaction that opens `resolvedCell` as the active cell.
 *
 * Shared by the dispatching entry points and by the boundary-deletion transaction
 * filter, which can only return a spec.
 *
 * The request suppresses navigation keys: until the nested editor mounts and takes focus,
 * the main editor still owns the keyboard with the caret parked in the table's replaced
 * range, so key repeat would otherwise walk it through the hidden Markdown.
 *
 * Any normalization the table needs is folded into this same transaction, so the whole
 * entry is one document change dispatched from the event that asked for it.
 */
export function prepareCellEntryTransaction(params: {
    state: EditorState;
    resolvedCell: ResolvedActiveCell;
    initialCursorPos?: InitialCursorPos;
}): PreparedOpenCellRequestTransaction {
    return prepareOpenCellRequestTransaction({
        state: params.state,
        resolvedCell: params.resolvedCell,
        initialCursorPos: params.initialCursorPos,
        suppressKeys: true,
    });
}

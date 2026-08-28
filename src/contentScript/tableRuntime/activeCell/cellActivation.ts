/**
 * Shared cell activation logic for activating table cells and opening nested editors.
 * Consolidated from nestedEditorLifecycle.ts and searchPanelWatcher.ts.
 */
import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { clearActiveCellEffect, getActiveCell, type ActiveCell } from '../../tableState/activeCellState';
import { isSourceModeEnabled } from '../../tableState/sourceMode';
import { resolveContainingTableAtPos, resolveTableContextAtPos } from '../tableResolution';
import { findCellForPos } from '../../tableModel/markdownTableCellRanges';
import { buildTableContext, type TableContext } from '../../tableModel/tableContext';
import { resolveClampedCell } from './activeCellFactory';
import { createResolvedActiveCell } from './resolvedActiveCell';
import {
    prepareOpenCellRequestTransaction,
    requestOpenCell,
    type PreparedOpenCellRequestTransaction,
} from '../openCellRequest';
import type { CellCoords } from '../../tableModel/types';
import type { InitialCursorPos } from '../../shared/cursorPlacement';

export interface ActivateCellOptions {
    /** If true and position is outside any table, clears active cell and focuses main editor (default: false) */
    clearIfOutside?: boolean;
    /** If true, normalize non-canonical tables before opening the nested editor (default: true) */
    normalizeIfNeeded?: boolean;
    /** If true, preserve the current main-editor selection when requesting the nested editor open */
    preserveMainSelection?: boolean;
    /** Optional fallback identity used when the cursor lands on table structure during lifecycle-driven reactivation */
    preferredActiveCell?: ActiveCell | null;
}

export interface ActivateTableCellOptions {
    initialCursorPos?: InitialCursorPos;
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
    // In source mode, tables are not rendered as widgets, so we cannot activate cells.
    if (isSourceModeEnabled(view.state)) {
        return false;
    }

    const table = resolveContainingTableAtPos(view.state, pos);

    if (!table) {
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
    const relativePos = pos - table.from;
    const ctx = buildTableContext(table);
    if (!ctx) {
        if (options?.clearIfOutside) {
            view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
        }
        return false;
    }

    // Cursor restoration during undo/redo can land on table punctuation or padding.
    // Preserve the current logical cell in that case instead of arbitrarily snapping to (0,0).
    const targetCell = resolveActivationTargetCell({
        tableFrom: ctx.from,
        relativePos,
        cellRanges: ctx.cellRanges,
        activeCell: options?.preferredActiveCell ?? getActiveCell(view.state),
    });

    const resolvedCell = resolveClampedCell({ ctx, target: targetCell });
    if (!resolvedCell) {
        if (options?.clearIfOutside) {
            view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
        }
        return false;
    }

    requestOpenCell(view, {
        state: view.state,
        target: { resolvedCell },
        normalizeIfNeeded: options?.normalizeIfNeeded ?? true,
        preserveMainSelection: options?.preserveMainSelection ?? false,
    });

    return true;
}

/**
 * Activates a specific cell by table position and coordinates.
 * Callers that depend on newly mounted widgets should schedule this after the
 * relevant DOM update has had a chance to render.
 * @returns true when an open-cell request was dispatched.
 */
export function activateTableCell(
    view: EditorView,
    tableFrom: number,
    coords: CellCoords,
    options: ActivateTableCellOptions = {}
): boolean {
    if (!view.dom.isConnected) return false;

    // Don't activate cells in source mode (no widgets exist)
    if (isSourceModeEnabled(view.state)) return false;

    const ctx = resolveTableContextAtPos(view.state, tableFrom);
    if (!ctx) return false;

    const spec = prepareCellEntryTransaction({
        state: view.state,
        ctx,
        coords,
        initialCursorPos: options.initialCursorPos,
    });
    if (!spec) return false;

    view.dispatch(spec);

    return true;
}

/**
 * Builds the transaction that opens `coords` as the active cell.
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
    ctx: TableContext;
    coords: CellCoords;
    initialCursorPos?: InitialCursorPos;
}): PreparedOpenCellRequestTransaction | null {
    const resolvedCell = createResolvedActiveCell({ ctx: params.ctx, coords: params.coords });
    if (!resolvedCell) {
        return null;
    }

    return prepareOpenCellRequestTransaction({
        state: params.state,
        target: { resolvedCell },
        initialCursorPos: params.initialCursorPos,
        suppressKeys: true,
    });
}

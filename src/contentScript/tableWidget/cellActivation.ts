/**
 * Shared cell activation logic for activating table cells and opening nested editors.
 * Consolidated from nestedEditorLifecycle.ts and searchPanelWatcher.ts.
 */
import { EditorView } from '@codemirror/view';
import { clearActiveCellEffect, getActiveCell, setActiveCellEffect } from './activeCellState';
import { findTableRanges } from './tablePositioning';
import { findCellForPos } from '../tableModel/markdownTableCellRanges';
import { buildTableContext } from '../tableModel/tableContext';
import { computeActiveCellFromRanges } from '../tableModel/activeCellForTableText';
import { openNestedCellEditor } from '../nestedEditor/nestedCellEditor';
import { findCellElement } from './domHelpers';
import { makeTableId } from '../tableModel/types';
import { isSourceModeEnabled } from './sourceMode';

export interface ActivateCellOptions {
    /** If true and position is outside any table, clears active cell and focuses main editor (default: false) */
    clearIfOutside?: boolean;
    /** If true, normalize non-canonical tables before opening the nested editor (default: true) */
    normalizeIfNeeded?: boolean;
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

    const tables = findTableRanges(view.state);

    // Find the table containing the position
    const table = tables.find((t) => pos >= t.from && pos <= t.to);

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
        activeCell: getActiveCell(view.state),
    });

    const newActiveCell = computeActiveCellFromRanges({
        tableFrom: ctx.from,
        ranges: ctx.cellRanges,
        target: targetCell,
    });

    if (!newActiveCell) {
        if (options?.clearIfOutside) {
            view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
        }
        return false;
    }

    // Set the active cell state before opening the nested editor.
    view.dispatch({
        effects: setActiveCellEffect.of(newActiveCell),
    });

    const cellElement = findCellElement(view, makeTableId(table.from), newActiveCell);
    if (!cellElement) {
        return false;
    }

    openNestedCellEditor({
        mainView: view,
        cellElement,
        activeCell: newActiveCell,
        normalizeIfNeeded: options?.normalizeIfNeeded ?? true,
    });

    return true;
}

/**
 * Activates a specific cell by table position and coordinates.
 * Waits for widget mount via requestAnimationFrame before activating.
 * Used after table insertion to activate the first cell.
 */
export function activateTableCell(
    view: EditorView,
    tableFrom: number,
    coords: { section: 'header' | 'body'; row: number; col: number }
): void {
    requestAnimationFrame(() => {
        if (!view.dom.isConnected) return;

        // Don't activate cells in source mode (no widgets exist)
        if (isSourceModeEnabled(view.state)) return;

        // Compute active cell state from the table
        const tables = findTableRanges(view.state);
        const table = tables.find((t) => t.from === tableFrom);
        if (!table) return;

        const ctx = buildTableContext(table);
        if (!ctx) return;

        const newActiveCell = computeActiveCellFromRanges({
            tableFrom: ctx.from,
            ranges: ctx.cellRanges,
            target: coords,
        });

        if (!newActiveCell) return;

        // Set the active cell state before opening the nested editor.
        view.dispatch({
            effects: setActiveCellEffect.of(newActiveCell),
        });

        const cellElement = findCellElement(view, makeTableId(tableFrom), coords);
        if (!cellElement) return;

        openNestedCellEditor({
            mainView: view,
            cellElement,
            activeCell: newActiveCell,
            normalizeIfNeeded: true,
        });
    });
}

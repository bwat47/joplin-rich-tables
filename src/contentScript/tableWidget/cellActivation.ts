/**
 * Shared cell activation logic for activating table cells and opening nested editors.
 * Consolidated from nestedEditorLifecycle.ts and searchPanelWatcher.ts.
 */
import { EditorView } from '@codemirror/view';
import { clearActiveCellEffect, setActiveCellEffect } from './activeCellState';
import { findTableRanges } from './tablePositioning';
import { computeMarkdownTableCellRanges, findCellForPos } from '../tableModel/markdownTableCellRanges';
import { computeActiveCellForTableText } from '../tableModel/activeCellForTableText';
import { openNestedCellEditor } from '../nestedEditor/nestedCellEditor';
import { findCellElement, SECTION_HEADER, SECTION_BODY } from './domHelpers';
import { makeTableId } from '../tableModel/types';
import { isSourceModeEnabled } from './sourceMode';

export interface ActivateCellOptions {
    /** If true and position is outside any table, clears active cell and focuses main editor (default: false) */
    clearIfOutside?: boolean;
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
    const ranges = computeMarkdownTableCellRanges(table.text);
    if (!ranges) {
        if (options?.clearIfOutside) {
            view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
        }
        return false;
    }

    // Find the cell containing the position, fallback to first body cell
    const targetCell = findCellForPos(ranges, relativePos) ?? { section: 'body' as const, row: 0, col: 0 };

    const newActiveCell = computeActiveCellForTableText({
        tableFrom: table.from,
        tableText: table.text,
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

    const cellElement = findCellElement(view, makeTableId(table.from), {
        section: newActiveCell.section === SECTION_HEADER ? SECTION_HEADER : SECTION_BODY,
        row: newActiveCell.section === SECTION_HEADER ? 0 : newActiveCell.row,
        col: newActiveCell.col,
    });
    if (!cellElement) {
        return false;
    }

    openNestedCellEditor({
        mainView: view,
        cellElement,
        cellFrom: newActiveCell.cellFrom,
        cellTo: newActiveCell.cellTo,
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

        const newActiveCell = computeActiveCellForTableText({
            tableFrom: table.from,
            tableText: table.text,
            target: coords,
        });

        if (!newActiveCell) return;

        // Set the active cell state before opening the nested editor.
        view.dispatch({
            effects: setActiveCellEffect.of(newActiveCell),
        });

        const cellElement = findCellElement(view, makeTableId(tableFrom), {
            section: coords.section === 'header' ? SECTION_HEADER : SECTION_BODY,
            row: coords.section === 'header' ? 0 : coords.row,
            col: coords.col,
        });
        if (!cellElement) return;

        openNestedCellEditor({
            mainView: view,
            cellElement,
            cellFrom: newActiveCell.cellFrom,
            cellTo: newActiveCell.cellTo,
        });
    });
}

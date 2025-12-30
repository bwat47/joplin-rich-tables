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
import { getCellSelector, getWidgetSelector, SECTION_HEADER, SECTION_BODY } from './domHelpers';
import { makeTableId } from '../tableModel/types';

export interface ActivateCellOptions {
    /** If true and position is outside any table, clears active cell and focuses main editor (default: false) */
    clearIfOutside?: boolean;
}

/**
 * Activates the cell at the given document position, opening the nested editor.
 * @returns true if a cell was activated, false otherwise
 */
export function activateCellAtPosition(view: EditorView, pos: number, options?: ActivateCellOptions): boolean {
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

    // IMPORTANT: Dispatch setActiveCellEffect FIRST to trigger widget creation.
    // The decorator StateField rebuilds when activeCellField changes, which creates
    // the widget DOM. We must dispatch before querying for the widget element.
    view.dispatch({
        effects: setActiveCellEffect.of(newActiveCell),
    });

    // Now query for the widget DOM (it should exist after the dispatch)
    const widgetDOM = view.dom.querySelector(getWidgetSelector(makeTableId(table.from)));
    if (!widgetDOM) {
        return false;
    }

    // Find the cell element
    const selector =
        newActiveCell.section === SECTION_HEADER
            ? getCellSelector({ section: SECTION_HEADER, row: 0, col: newActiveCell.col })
            : getCellSelector({ section: SECTION_BODY, row: newActiveCell.row, col: newActiveCell.col });

    const cellElement = widgetDOM.querySelector(selector) as HTMLElement | null;
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

        // IMPORTANT: Dispatch setActiveCellEffect FIRST to trigger widget creation.
        // When inserting a new table, the cursor is inside the table range, which normally
        // prevents widget creation. The setActiveCellEffect marks the table as "active",
        // which triggers the decorator to create the widget even with cursor in range.
        view.dispatch({
            effects: setActiveCellEffect.of(newActiveCell),
        });

        // Now query for the widget and cell element (should exist after dispatch)
        const widgetDOM = view.dom.querySelector(getWidgetSelector(makeTableId(tableFrom)));
        if (!widgetDOM) return;

        const selector =
            coords.section === 'header'
                ? getCellSelector({ section: SECTION_HEADER, row: 0, col: coords.col })
                : getCellSelector({ section: SECTION_BODY, row: coords.row, col: coords.col });

        const cellElement = widgetDOM.querySelector(selector) as HTMLElement | null;
        if (!cellElement) return;

        openNestedCellEditor({
            mainView: view,
            cellElement,
            cellFrom: newActiveCell.cellFrom,
            cellTo: newActiveCell.cellTo,
        });
    });
}

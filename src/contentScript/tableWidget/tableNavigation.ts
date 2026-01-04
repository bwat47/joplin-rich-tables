import { EditorView } from '@codemirror/view';
import { SECTION_BODY, SECTION_HEADER, findCellElement } from './domHelpers';
import { getActiveCell, setActiveCellEffect } from './activeCellState';
import { resolveTableAtPos, resolveCellDocRange } from './tablePositioning';
import { computeMarkdownTableCellRanges } from '../tableModel/markdownTableCellRanges';
import { openNestedCellEditor } from '../nestedEditor/nestedCellEditor';
import { execInsertRowAtBottom } from '../tableCommands/tableCommands';
import { makeTableId, type CellCoords } from '../tableModel/types';
import {
    isNavigationLocked,
    acquireNavigationLock,
    releaseNavigationLock,
    setPendingNavigationCallback,
} from './navigationLock';

export function navigateCell(
    view: EditorView,
    direction: 'next' | 'previous' | 'up' | 'down',
    options: { cursorPos?: 'start' | 'end'; allowRowCreation?: boolean } = {}
): boolean {
    // Prevent race conditions from rapid key-holding
    if (isNavigationLocked()) {
        return true; // Swallow keypress, navigation already in progress
    }

    const state = view.state;
    const activeCell = getActiveCell(state);

    if (!activeCell) {
        return false;
    }

    // Resolve the table structure to know valid rows/cols
    const table = resolveTableAtPos(state, activeCell.cellFrom);
    if (!table) {
        return false;
    }

    const cellRanges = computeMarkdownTableCellRanges(table.text);
    if (!cellRanges) {
        return false;
    }

    const numBodyRows = cellRanges.rows.length;
    // Assuming uniform column count for now, based on header
    const numCols = cellRanges.headers.length;

    // Convert to unified grid coordinates:
    // Header row = 0
    // Body row i = i + 1
    let unifiedRow = activeCell.section === SECTION_HEADER ? 0 : activeCell.row + 1;
    let unifiedCol = activeCell.col;

    // Total rows = header (1) + body rows
    const totalRows = 1 + numBodyRows;

    // --- Core Navigation Logic ---

    if (direction === 'next') {
        unifiedCol++;
        if (unifiedCol >= numCols) {
            unifiedCol = 0;
            unifiedRow++;
        }
    } else if (direction === 'previous') {
        unifiedCol--;
        if (unifiedCol < 0) {
            unifiedCol = numCols - 1;
            unifiedRow--;
        }
    } else if (direction === 'down') {
        unifiedRow++;
    } else if (direction === 'up') {
        unifiedRow--;
    }

    // --- Boundary Handling ---

    // Check if we walked off the table (top or bottom)
    if (unifiedRow < 0) {
        // Navigation stopped at table start - don't wrap around or move cursor
        return true;
    }

    if (unifiedRow >= totalRows) {
        if (options.allowRowCreation) {
            // Acquire lock before row creation (which opens a nested editor)
            if (!acquireNavigationLock()) {
                return true; // Already locked
            }
            // Tab ('next') goes to first col, Enter/down stays in same col
            const targetCol = direction === 'next' ? 0 : activeCell.col;
            const success = execInsertRowAtBottom(view, activeCell, targetCol);
            if (!success) {
                // Row creation failed (parse error, no-op) - release lock immediately
                releaseNavigationLock();
            } else {
                // Set pending callback for row creation path (goes through lifecycle plugin)
                setPendingNavigationCallback(releaseNavigationLock);
            }
            return true;
        }
        // Walked off end of table
        return true;
    }

    // --- Convert back to Section/Row ---

    let targetSection: 'header' | 'body';
    let targetRow: number;

    if (unifiedRow === 0) {
        targetSection = SECTION_HEADER;
        targetRow = 0;
    } else {
        targetSection = SECTION_BODY;
        targetRow = unifiedRow - 1;
    }

    const target: CellCoords = {
        section: targetSection,
        row: targetRow,
        col: unifiedCol,
    };

    // Activate target cell
    const resolvedRange = resolveCellDocRange({
        tableFrom: table.from,
        ranges: cellRanges,
        coords: target,
    });

    if (!resolvedRange) {
        return false;
    }

    // Acquire lock before dispatching state changes
    if (!acquireNavigationLock()) {
        return true; // Already locked
    }

    const { cellFrom, cellTo } = resolvedRange;

    view.dispatch({
        effects: setActiveCellEffect.of({
            tableFrom: table.from,
            tableTo: table.to,
            cellFrom,
            cellTo,
            section: target.section, // Use the proper Section type
            row: target.row,
            col: target.col,
        }),
    });

    // After dispatch, query for the fresh cell element using data attributes.
    // The DOM is ready synchronously after dispatch since CodeMirror applies decorations synchronously.
    const cellElement = findCellElement(view, makeTableId(table.from), target);

    if (cellElement) {
        openNestedCellEditor({
            mainView: view,
            cellElement,
            cellFrom,
            cellTo,
            initialCursorPos: options.cursorPos,
            onFocused: releaseNavigationLock,
        });
    } else {
        // No cell element found, release lock immediately
        releaseNavigationLock();
    }

    return true;
}

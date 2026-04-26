import { EditorView } from '@codemirror/view';
import {
    getResolvedActiveCell,
    resolveCellWithinResolvedTable,
    type ResolvedActiveCell,
} from '../activeCell/resolvedActiveCell';
import { insertRowAtBottom } from '../operations/structuralOperations';
import { type CellCoords } from '../../tableModel/types';
import { SECTION_BODY, SECTION_HEADER } from '../../tableWidget/domHelpers';
import { requestOpenCell, shouldSuppressNavigationKeys } from '../openCellRequest';

function insertRowFromKeyboardNavigation(
    view: EditorView,
    resolvedActiveCell: ResolvedActiveCell,
    targetCol: number
): boolean {
    if (shouldSuppressNavigationKeys(view.state)) {
        return true; // Already locked
    }

    insertRowAtBottom(view, resolvedActiveCell, targetCol, {
        suppressKeys: true,
    });

    return true;
}

export function navigateCell(
    view: EditorView,
    direction: 'next' | 'previous' | 'up' | 'down',
    options: { cursorPos?: 'start' | 'end' | 'lastLineStart'; allowRowCreation?: boolean } = {}
): boolean {
    // Prevent race conditions from rapid key-holding
    if (shouldSuppressNavigationKeys(view.state)) {
        return true; // Swallow keypress, navigation already in progress
    }

    const state = view.state;
    const resolvedActiveCell = getResolvedActiveCell(state);
    if (!resolvedActiveCell) {
        return false;
    }
    const activeCell = resolvedActiveCell.activeCell;
    const ctx = resolvedActiveCell.ctx;

    const numBodyRows = ctx.cellRanges.rows.length;
    // Assuming uniform column count for now, based on header
    const numCols = ctx.cellRanges.headers.length;

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
            // Tab ('next') goes to first col, Enter/down stays in same col
            const targetCol = direction === 'next' ? 0 : activeCell.col;
            return insertRowFromKeyboardNavigation(view, resolvedActiveCell, targetCol);
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
    const nextResolvedCell = resolveCellWithinResolvedTable(resolvedActiveCell, target);
    if (!nextResolvedCell) {
        return false;
    }

    requestOpenCell(view, {
        target: { resolvedCell: nextResolvedCell },
        normalizeIfNeeded: true,
        initialCursorPos: options.cursorPos,
        suppressKeys: true,
    });

    return true;
}

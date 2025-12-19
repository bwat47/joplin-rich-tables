import { EditorView } from '@codemirror/view';
import { SECTION_BODY, SECTION_HEADER, getCellSelector, getWidgetSelector } from './domConstants';
import { getActiveCell, setActiveCellEffect, type ActiveCellSection } from './activeCellState';
import { resolveTableAtPos, getTableCellRanges, resolveCellDocRange } from './tablePositioning';
import { openNestedCellEditor } from '../nestedEditor/nestedCellEditor';

export function navigateCell(
    view: EditorView,
    direction: 'next' | 'previous' | 'up' | 'down',
    options: { cursorPos?: 'start' | 'end' } = {}
): boolean {
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

    const cellRanges = getTableCellRanges(table.text);
    if (!cellRanges) {
        return false;
    }

    const numRows = cellRanges.rows.length;
    // Assuming uniform column count for now, based on header
    const numCols = cellRanges.headers.length;

    let targetSection: ActiveCellSection = activeCell.section;
    let targetRow = activeCell.row;
    let targetCol = activeCell.col;

    if (direction === 'next') {
        targetCol++;
        if (targetCol >= numCols) {
            targetCol = 0;
            if (targetSection === SECTION_HEADER) {
                targetSection = SECTION_BODY;
                targetRow = 0;
            } else {
                targetRow++;
            }
        }
    } else if (direction === 'previous') {
        targetCol--;
        if (targetCol < 0) {
            targetCol = numCols - 1;
            if (targetSection === SECTION_BODY) {
                if (targetRow === 0) {
                    targetSection = SECTION_HEADER;
                    targetRow = 0; // Header is effectively row 0
                } else {
                    targetRow--;
                }
            } else {
                // Wrap to previous table? Or stop?
                // For now, stop at first cell
                return true;
            }
        }
    } else if (direction === 'down') {
        if (targetSection === SECTION_HEADER) {
            targetSection = SECTION_BODY;
            targetRow = 0;
        } else {
            targetRow++;
        }
    } else if (direction === 'up') {
        if (targetSection === SECTION_BODY) {
            if (targetRow === 0) {
                targetSection = SECTION_HEADER;
                targetRow = 0;
            } else {
                targetRow--;
            }
        } else {
            // Already at header, stop
            return true;
        }
    }

    // Boundary checks
    if (targetSection === SECTION_BODY) {
        if (targetRow >= numRows) {
            // End of table
            return true;
        }
    }

    // Activate target cell
    const resolvedRange = resolveCellDocRange({
        tableFrom: table.from,
        ranges: cellRanges,
        section: targetSection,
        row: targetRow,
        col: targetCol,
    });

    if (!resolvedRange) {
        return false;
    }

    const { cellFrom, cellTo } = resolvedRange;

    // Dispatch update to active cell state
    view.dispatch({
        effects: setActiveCellEffect.of({
            tableFrom: table.from,
            tableTo: table.to,
            cellFrom,
            cellTo,
            section: targetSection,
            row: targetSection === SECTION_HEADER ? 0 : targetRow,
            col: targetCol,
        }),
    });

    // After dispatch, query for the fresh cell element using data attributes.
    // The DOM is ready synchronously after dispatch since CodeMirror applies decorations synchronously.
    const widgetDOM = view.dom.querySelector(getWidgetSelector(table.from));
    if (widgetDOM) {
        const selector =
            targetSection === SECTION_HEADER
                ? getCellSelector(SECTION_HEADER, 0, targetCol)
                : getCellSelector(SECTION_BODY, targetRow, targetCol);

        const cellElement = widgetDOM.querySelector(selector) as HTMLElement | null;

        if (cellElement) {
            openNestedCellEditor({
                mainView: view,
                cellElement,
                cellFrom,
                cellTo,
                initialCursorPos: options.cursorPos,
            });
        }
    }

    return true;
}

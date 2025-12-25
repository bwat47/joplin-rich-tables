import { EditorView } from '@codemirror/view';
import { SECTION_BODY, SECTION_HEADER, getCellSelector, getWidgetSelector } from './domHelpers';
import { getActiveCell, setActiveCellEffect } from './activeCellState';
import { resolveTableAtPos, resolveCellDocRange } from './tablePositioning';
import { computeMarkdownTableCellRanges } from '../tableModel/markdownTableCellRanges';
import { openNestedCellEditor } from '../nestedEditor/nestedCellEditor';
import { makeTableId, type CellCoords } from '../tableModel/types';

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

    const cellRanges = computeMarkdownTableCellRanges(table.text);
    if (!cellRanges) {
        return false;
    }

    const numRows = cellRanges.rows.length;
    // Assuming uniform column count for now, based on header
    const numCols = cellRanges.headers.length;

    let target: CellCoords = {
        section: activeCell.section,
        row: activeCell.row,
        col: activeCell.col,
    };

    if (direction === 'next') {
        target.col++;
        if (target.col >= numCols) {
            target.col = 0;
            if (target.section === SECTION_HEADER) {
                target.section = SECTION_BODY;
                target.row = 0;
            } else {
                target.row++;
            }
        }
    } else if (direction === 'previous') {
        target.col--;
        if (target.col < 0) {
            target.col = numCols - 1;
            if (target.section === SECTION_BODY) {
                if (target.row === 0) {
                    target.section = SECTION_HEADER;
                    target.row = 0; // Header is effectively row 0
                } else {
                    target.row--;
                }
            } else {
                // Wrap to previous table? Or stop?
                // For now, stop at first cell
                return true;
            }
        }
    } else if (direction === 'down') {
        if (target.section === SECTION_HEADER) {
            target.section = SECTION_BODY;
            target.row = 0;
        } else {
            target.row++;
        }
    } else if (direction === 'up') {
        if (target.section === SECTION_BODY) {
            if (target.row === 0) {
                target.section = SECTION_HEADER;
                target.row = 0;
            } else {
                target.row--;
            }
        } else {
            // Already at header, stop
            return true;
        }
    }

    // Boundary checks
    if (target.section === SECTION_BODY) {
        if (target.row >= numRows) {
            // End of table
            return true;
        }
    }

    // Activate target cell
    const resolvedRange = resolveCellDocRange({
        tableFrom: table.from,
        ranges: cellRanges,
        coords: target,
    });

    if (!resolvedRange) {
        return false;
    }

    const { cellFrom, cellTo } = resolvedRange;

    view.dispatch({
        effects: setActiveCellEffect.of({
            tableFrom: table.from,
            tableTo: table.to,
            cellFrom,
            cellTo,
            section: target.section,
            row: target.section === SECTION_HEADER ? 0 : target.row,
            col: target.col,
        }),
    });

    // After dispatch, query for the fresh cell element using data attributes.
    // The DOM is ready synchronously after dispatch since CodeMirror applies decorations synchronously.
    const widgetDOM = view.dom.querySelector(getWidgetSelector(makeTableId(table.from)));
    if (widgetDOM) {
        const selector = getCellSelector(target);

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

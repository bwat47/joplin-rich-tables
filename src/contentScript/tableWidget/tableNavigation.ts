import { EditorView } from '@codemirror/view';
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
            if (targetSection === 'header') {
                targetSection = 'body';
                targetRow = 0;
            } else {
                targetRow++;
            }
        }
    } else if (direction === 'previous') {
        targetCol--;
        if (targetCol < 0) {
            targetCol = numCols - 1;
            if (targetSection === 'body') {
                if (targetRow === 0) {
                    targetSection = 'header';
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
        if (targetSection === 'header') {
            targetSection = 'body';
            targetRow = 0;
        } else {
            targetRow++;
        }
    } else if (direction === 'up') {
        if (targetSection === 'body') {
            if (targetRow === 0) {
                targetSection = 'header';
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
    if (targetSection === 'body') {
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
            row: targetSection === 'header' ? 0 : targetRow,
            col: targetCol,
        }),
    });

    // Determine the DOM element for the target cell to anchor the editor
    // We can't easily find the exact DOM node synchronously because it might need a re-render
    // if the table was just modified. However, since we are just navigating, the structure
    // likely exists.
    //
    // We need the cell element for `openNestedCellEditor` to mount the subview.
    // We can try to find it via the data attributes on the rendered widget.

    // Slight delay to allow DOM to settle if needed, or try immediate lookup
    setTimeout(() => {
        const widgetDOM = view.dom.querySelector(`.cm-table-widget[data-table-from="${table.from}"]`);
        if (!widgetDOM) return;

        const selector =
            targetSection === 'header'
                ? `th[data-section="header"][data-col="${targetCol}"]`
                : `td[data-section="body"][data-row="${targetRow}"][data-col="${targetCol}"]`;

        const cellElement = widgetDOM.querySelector(selector) as HTMLElement;

        if (cellElement) {
            openNestedCellEditor({
                mainView: view,
                cellElement,
                cellFrom,
                cellTo,
                initialCursorPos: options.cursorPos,
            });
        }
    }, 0);

    return true;
}

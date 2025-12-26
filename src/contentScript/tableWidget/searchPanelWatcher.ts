/**
 * Watches for Joplin's search panel open/close transitions.
 * - On close: auto-activates cell editor if cursor is inside a table
 * - On open: closes nested editor to allow searching
 */
import { StateField, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { searchPanelOpen } from '@codemirror/search';
import { resolveTableAtPos, resolveCellDocRange } from './tablePositioning';
import { computeMarkdownTableCellRanges, findCellForPos } from '../tableModel/markdownTableCellRanges';
import { setActiveCellEffect, clearActiveCellEffect, getActiveCell } from './activeCellState';
import { closeNestedCellEditor, isNestedCellEditorOpen, openNestedCellEditor } from '../nestedEditor/nestedCellEditor';
import { getCellSelector, getWidgetSelector, SECTION_HEADER } from './domHelpers';
import { makeTableId } from '../tableModel/types';

/**
 * Creates the search panel watcher extension.
 * Requires the main EditorView reference to dispatch effects and open editors.
 */
export function createSearchPanelWatcher(mainView: EditorView): Extension {
    return StateField.define<boolean>({
        create: (state) => searchPanelOpen(state),
        update(wasOpen, tr) {
            const isOpen = searchPanelOpen(tr.state);

            // Search panel just opened → close nested editor and clear active cell
            if (!wasOpen && isOpen) {
                queueMicrotask(() => {
                    if (isNestedCellEditorOpen(mainView)) {
                        closeNestedCellEditor(mainView);
                    }
                    // Clear active cell state to dismiss toolbar and render table normally
                    if (getActiveCell(mainView.state)) {
                        mainView.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                    }
                });
            }

            // Search panel just closed → activate cell if cursor is in table
            if (wasOpen && !isOpen) {
                queueMicrotask(() => {
                    activateCellAtCursor(mainView);
                });
            }

            return isOpen;
        },
    });
}

/**
 * If the main editor cursor is inside a table cell, activate that cell
 * and open the nested editor.
 */
function activateCellAtCursor(view: EditorView): void {
    const state = view.state;
    const cursorPos = state.selection.main.head;

    // Resolve the table at cursor position
    const table = resolveTableAtPos(state, cursorPos);
    if (!table) {
        return;
    }

    // Parse the table structure
    const cellRanges = computeMarkdownTableCellRanges(table.text);
    if (!cellRanges) {
        return;
    }

    // Find which cell contains the cursor (relative position within table)
    const relativePos = cursorPos - table.from;
    const cellInfo = findCellForPos(cellRanges, relativePos);
    if (!cellInfo) {
        return;
    }

    const { section, row, col } = cellInfo;

    // Resolve the document range for this cell
    const resolvedRange = resolveCellDocRange({
        tableFrom: table.from,
        ranges: cellRanges,
        coords: { section, row, col },
    });
    if (!resolvedRange) {
        return;
    }

    const { cellFrom, cellTo } = resolvedRange;

    // Dispatch to activate the cell
    view.dispatch({
        selection: { anchor: cursorPos },
        effects: setActiveCellEffect.of({
            tableFrom: table.from,
            tableTo: table.to,
            cellFrom,
            cellTo,
            section,
            row: section === SECTION_HEADER ? 0 : row,
            col,
        }),
    });

    // After dispatch, query for the fresh cell element and open nested editor
    const freshWidget = view.dom.querySelector(getWidgetSelector(makeTableId(table.from))) as HTMLElement | null;

    if (freshWidget) {
        const freshCell = freshWidget.querySelector(getCellSelector({ section, row, col })) as HTMLElement | null;

        if (freshCell) {
            openNestedCellEditor({
                mainView: view,
                cellElement: freshCell,
                cellFrom,
                cellTo,
            });
        }
    }
}

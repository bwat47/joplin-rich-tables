import { type CellCoords, type TableId, makeTableId } from '../tableModel/types';
import type { EditorView } from '@codemirror/view';

// Main widget structure classes
export const CLASS_TABLE_WIDGET = 'cm-table-widget';
export const CLASS_TABLE_WIDGET_TABLE = 'cm-table-widget-table';
export const CLASS_CELL_ACTIVE = 'cm-table-cell-active';

// Nested editor wrapper elements hosted inside table cells
export const CLASS_CELL_CONTENT = 'cm-table-cell-content';
export const CLASS_CELL_EDITOR = 'cm-table-cell-editor';
export const CLASS_CELL_EDITOR_HIDDEN = 'cm-table-cell-editor-hidden';

// Floating toolbar container (positioned relative to the active table widget)
export const CLASS_FLOATING_TOOLBAR = 'cm-table-floating-toolbar';

// Data attribute names (as they appear in the DOM, use with setAttribute/getAttribute)
export const ATTR_TABLE_FROM = 'table-from';

// Data attribute names (simple names that work with both dataset API and selectors)
export const DATA_SECTION = 'section';
export const DATA_ROW = 'row';
export const DATA_COL = 'col';

export const SECTION_HEADER = 'header';
export const SECTION_BODY = 'body';

/**
 * Returns the CSS selector for the table widget, optionally targeting a specific table instance.
 *
 * @param tableId - Optional TableId identifying the table.
 * @returns The CSS selector string.
 *
 * @example
 * getWidgetSelector(); // returns '.cm-table-widget'
 * getWidgetSelector(makeTableId(105)); // returns '.cm-table-widget[data-table-from="105"]'
 */
export function getWidgetSelector(tableId?: TableId): string {
    const base = `.${CLASS_TABLE_WIDGET}`;
    if (tableId !== undefined) {
        return `${base}[data-${ATTR_TABLE_FROM}="${tableId}"]`;
    }
    return base;
}

/**
 * Returns the CSS selector for a specific cell within a table widget.
 *
 * @param coords - The cell coordinates (section, row, col).
 * @returns The CSS selector string targeting the specific data attributes.
 *
 * @example
 * getCellSelector({ section: 'header', row: 0, col: 2 }); // returns '[data-section="header"][data-row="0"][data-col="2"]'
 * getCellSelector({ section: 'body', row: 1, col: 0 });   // returns '[data-section="body"][data-row="1"][data-col="0"]'
 */
export function getCellSelector(coords: CellCoords): string {
    return `[data-${DATA_SECTION}="${coords.section}"][data-${DATA_ROW}="${coords.row}"][data-${DATA_COL}="${coords.col}"]`;
}

/**
 * Helper to locate a specific cell element in the DOM for a given table.
 *
 * @param view - The main EditorView
 * @param tableId - The TableId (current table position from syntax tree)
 * @param coords - The coordinates of the cell to find
 * @returns The matching HTMLElement for the cell if found, otherwise null.
 */

export function findCellElement(view: EditorView, tableId: TableId, coords: CellCoords): HTMLElement | null {
    // Find the widget by matching its current document position.
    // We can't use data-table-from directly because it may be stale after
    // decorations are mapped (but not rebuilt) through edits.
    const allWidgets = view.dom.querySelectorAll(getWidgetSelector());
    let widgetDOM: Element | null = null;

    for (const widget of allWidgets) {
        try {
            const widgetPos = view.posAtDOM(widget);
            if (makeTableId(widgetPos) === tableId) {
                widgetDOM = widget;
                break;
            }
        } catch {
            // posAtDOM can fail for edge cases, continue
        }
    }

    if (!widgetDOM) {
        return null;
    }

    // Find the cell within that widget
    const cellSelector = getCellSelector(coords);
    return widgetDOM.querySelector(cellSelector) as HTMLElement | null;
}

import type { CellCoords, TableId } from '../tableModel/types';

export const CLASS_TABLE_WIDGET = 'cm-table-widget';
export const CLASS_TABLE_WIDGET_TABLE = 'cm-table-widget-table';
export const CLASS_CELL_ACTIVE = 'cm-table-cell-active';

// Nested editor wrapper elements hosted inside table cells
export const CLASS_CELL_CONTENT = 'cm-table-cell-content';
export const CLASS_CELL_EDITOR = 'cm-table-cell-editor';
export const CLASS_CELL_EDITOR_HIDDEN = 'cm-table-cell-editor-hidden';

// Floating toolbar container (positioned relative to the active table widget)
export const CLASS_FLOATING_TOOLBAR = 'cm-table-floating-toolbar';

export const DATA_TABLE_FROM = 'tableFrom';
export const DATA_TABLE_TO = 'tableTo';
export const DATA_SECTION = 'section';
export const DATA_ROW = 'row';
export const DATA_COL = 'col';

export const SECTION_HEADER = 'header';
export const SECTION_BODY = 'body';

/**
 * Converts a camelCase dataset key to its corresponding kebab-case data attribute name.
 *
 * @param datasetKey - The dataset key (e.g., 'tableFrom').
 * @returns The data attribute name suffix (e.g., '-table-from').
 *
 * @example
 * datasetKeyToDataAttributeName('tableFrom'); // returns '-table-from'
 * datasetKeyToDataAttributeName('fooBarBaz'); // returns '-foo-bar-baz'
 */
function datasetKeyToDataAttributeName(datasetKey: string): string {
    return datasetKey.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

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
        const dataAttr = datasetKeyToDataAttributeName(DATA_TABLE_FROM);
        return `${base}[data-${dataAttr}="${tableId}"]`;
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

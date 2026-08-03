import { type CellCoords, type TableId, type TableSection, makeTableId } from '../tableModel/types';
import type { EditorView } from '@codemirror/view';

// Main widget structure classes
export const CLASS_TABLE_WIDGET = 'cm-table-widget';
export const CLASS_TABLE_WIDGET_TABLE = 'cm-table-widget-table';
export const CLASS_CELL_SELECTED = 'cm-table-cell-selected';

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
 * Returns the CSS selector matching every table widget root.
 *
 * Deliberately position-agnostic: identity comes from `posAtDOM()` via
 * `findTableWidgetElement()`, never from `data-table-from`.
 *
 * @returns The CSS selector string.
 *
 * @example
 * getWidgetSelector(); // returns '.cm-table-widget'
 */
export function getWidgetSelector(): string {
    return `.${CLASS_TABLE_WIDGET}`;
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

/** Narrows a raw `data-section` value to a known table section. */
function isTableSection(value: string | undefined): value is TableSection {
    return value === SECTION_HEADER || value === SECTION_BODY;
}

/** Parses a raw `data-row`/`data-col` value, returning null when it is not a number. */
function readIndex(value: string | undefined): number | null {
    const index = Number(value);
    return Number.isNaN(index) ? null : index;
}

/**
 * Reads cell coordinates back off a cell element's data attributes.
 *
 * The inverse of `getCellSelector()`, and the only supported way to turn a DOM
 * cell into `CellCoords`: the attributes are written solely by `TableWidget`,
 * so anything failing validation is not one of its cells.
 *
 * @param cell - A `td`/`th` element to read coordinates from.
 * @returns The coordinates, or null when any attribute is missing or unparseable.
 */
export function readCellCoords(cell: HTMLElement): CellCoords | null {
    const section = cell.dataset[DATA_SECTION];
    const row = readIndex(cell.dataset[DATA_ROW]);
    const col = readIndex(cell.dataset[DATA_COL]);

    if (!isTableSection(section) || row === null || col === null) {
        return null;
    }

    // The header is always a single row, so its row index is pinned to 0.
    return { section, row: section === SECTION_HEADER ? 0 : row, col };
}

/**
 * Locate a table widget root element by matching its current document position.
 *
 * We deliberately avoid relying on `data-table-from` for identity because it may
 * become stale when decorations are mapped (but not rebuilt) through edits.
 */
export function findTableWidgetElement(view: EditorView, tableId: TableId): HTMLElement | null {
    // Prefer contentDOM so we only scan editor content (not gutters/toolbars).
    const allWidgets = view.contentDOM.querySelectorAll(getWidgetSelector());

    for (const widget of allWidgets) {
        try {
            const widgetPos = view.posAtDOM(widget);
            if (makeTableId(widgetPos) === tableId) {
                return widget as HTMLElement;
            }
        } catch {
            // posAtDOM can fail for edge cases, continue
        }
    }

    return null;
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
    const widgetDOM = findTableWidgetElement(view, tableId);
    if (!widgetDOM) return null;

    // Find the cell within that widget
    const cellSelector = getCellSelector(coords);
    return widgetDOM.querySelector(cellSelector) as HTMLElement | null;
}

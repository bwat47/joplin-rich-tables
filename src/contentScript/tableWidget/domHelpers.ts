import { type CellCoords, type TableSection } from '../tableModel/types';
import type { EditorView } from '@codemirror/view';

// Main widget structure classes
export const CLASS_TABLE_WIDGET = 'cm-table-widget';
export const CLASS_TABLE_WIDGET_TABLE = 'cm-table-widget-table';
export const CLASS_CELL_SELECTED = 'cm-table-cell-selected';
/** Set on a widget root while the main editor's selection covers its whole table. */
export const CLASS_TABLE_WIDGET_SELECTED = 'cm-table-widget-selected';

// Floating toolbar container (positioned relative to the active table widget)
export const CLASS_FLOATING_TOOLBAR = 'cm-table-floating-toolbar';

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
 * `findTableWidgetElement()`.
 *
 * @returns The CSS selector string.
 *
 * @example
 * getWidgetSelector(); // returns '.cm-table-widget'
 */
export function getWidgetSelector(): string {
    return `.${CLASS_TABLE_WIDGET}`;
}

/** Matches the coordinate attributes `TableWidget` writes on every cell it renders. */
export const CELL_COORDS_ATTRIBUTES = `[data-${DATA_SECTION}][data-${DATA_ROW}][data-${DATA_COL}]`;

/** The element types `TableWidget` renders cells as. */
export const CELL_TAGS = ['td', 'th'] as const;

/**
 * Matches a table widget's own cells, and only those.
 *
 * The attributes are required so `closest()` walks past `td`/`th` belonging to a raw HTML
 * table inside a cell's rendered Markdown, which carry no coordinates of their own.
 */
export const SELECTOR_CELL = CELL_TAGS.map((tag) => `${tag}${CELL_COORDS_ATTRIBUTES}`).join(', ');

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
 * Widget identity comes from CodeMirror's live DOM-to-document mapping, which stays current
 * when decorations are mapped without rebuilding their DOM.
 */
export function findTableWidgetElement(view: EditorView, tableFrom: number): HTMLElement | null {
    // Prefer contentDOM so we only scan editor content (not gutters/toolbars).
    const allWidgets = view.contentDOM.querySelectorAll(getWidgetSelector());

    for (const widget of allWidgets) {
        try {
            const widgetPos = view.posAtDOM(widget);
            if (widgetPos === tableFrom) {
                return widget as HTMLElement;
            }
        } catch {
            // posAtDOM can fail for edge cases, continue
        }
    }

    return null;
}

/**
 * Returns the `<table>` a widget root renders its cells into.
 *
 * Scoped to a direct child so it never matches a raw HTML table inside a cell's rendered Markdown.
 *
 * @param widgetElement - A widget root from `findTableWidgetElement()`.
 * @returns The widget's own table element, or `null` if the widget has not rendered one.
 */
export function findWidgetTableElement(widgetElement: HTMLElement): HTMLElement | null {
    return widgetElement.querySelector(`:scope > .${CLASS_TABLE_WIDGET_TABLE}`);
}

/**
 * Helper to locate a specific cell element in the DOM for a given table.
 *
 * @param view - The main EditorView
 * @param tableFrom - Current table position from the document table index.
 * @param coords - The coordinates of the cell to find
 * @returns The matching HTMLElement for the cell if found, otherwise null.
 */

export function findCellElement(view: EditorView, tableFrom: number, coords: CellCoords): HTMLElement | null {
    const widgetDOM = findTableWidgetElement(view, tableFrom);
    if (!widgetDOM) return null;

    // Find the cell within that widget
    const cellSelector = getCellSelector(coords);
    return widgetDOM.querySelector(cellSelector) as HTMLElement | null;
}

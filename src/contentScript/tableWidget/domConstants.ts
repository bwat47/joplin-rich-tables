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

function datasetKeyToDataAttributeName(datasetKey: string): string {
    // dataset properties (camelCase) map to kebab-case attributes in HTML.
    // e.g. dataset.tableFrom -> data-table-from
    return datasetKey.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

export function getWidgetSelector(tableFrom?: number | string): string {
    const base = `.${CLASS_TABLE_WIDGET}`;
    if (tableFrom !== undefined) {
        const dataAttr = datasetKeyToDataAttributeName(DATA_TABLE_FROM);
        return `${base}[data-${dataAttr}="${tableFrom}"]`;
    }
    return base;
}

export function getCellSelector(section: string, row: number, col: number): string {
    // Note: row is 0-based.
    // data-section="header|body"
    // data-row="0..N"
    // data-col="0..M"
    // These constants (section, row, col) are already lowercase, so they don't require
    // datasetKeyToDataAttributeName conversion like DATA_TABLE_FROM does.
    return `[data-${DATA_SECTION}="${section}"][data-${DATA_ROW}="${row}"][data-${DATA_COL}="${col}"]`;
}

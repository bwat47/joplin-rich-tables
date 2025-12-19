export const CLASS_TABLE_WIDGET = 'cm-table-widget';
export const CLASS_TABLE_WIDGET_TABLE = 'cm-table-widget-table';
export const CLASS_CELL_ACTIVE = 'cm-table-cell-active';

export const DATA_TABLE_FROM = 'tableFrom';
export const DATA_TABLE_TO = 'tableTo';
export const DATA_SECTION = 'section';
export const DATA_ROW = 'row';
export const DATA_COL = 'col';

export const SECTION_HEADER = 'header';
export const SECTION_BODY = 'body';

export function getWidgetSelector(tableFrom?: number | string): string {
    const base = `.${CLASS_TABLE_WIDGET}`;
    if (tableFrom !== undefined) {
        return `${base}[data-${
            // dataset properties (camelCase) map to kebab-case attributes in HTML.
            // e.g. dataset.tableFrom -> data-table-from.
            // We correspond to DATA_TABLE_FROM ('tableFrom') but hardcode the attribute name here.
            'table-from'
        }="${tableFrom}"]`;
    }
    return base;
}

export function getCellSelector(section: string, row: number, col: number): string {
    // Note: row is 0-based.
    // data-section="header|body"
    // data-row="0..N"
    // data-col="0..M"
    return `[data-${DATA_SECTION}="${section}"][data-${DATA_ROW}="${row}"][data-${DATA_COL}="${col}"]`;
}

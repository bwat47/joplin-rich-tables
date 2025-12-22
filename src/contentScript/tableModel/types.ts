/**
 * Shared types for table cell and table identification.
 */

export type TableSection = 'header' | 'body';

/**
 * Coordinates identifying a cell within a table.
 * Used to group (section, row, col) into a single type-safe object.
 */
export interface CellCoords {
    section: TableSection;
    row: number; // 0-based index (relative to section; header row is always 0)
    col: number; // 0-based index
}

/**
 * Branded type for table identity.
 * Currently based on the table's starting document position (tableFrom),
 * but wrapping it allows future changes (e.g., to UUID) without breaking call sites.
 */
export type TableId = string & { readonly __brand: unique symbol };

/**
 * Creates a TableId from a document position.
 */
export function makeTableId(tableFrom: number): TableId {
    return String(tableFrom) as TableId;
}

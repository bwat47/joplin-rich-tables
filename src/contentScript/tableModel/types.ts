/**
 * Shared types for table cell and table identification.
 */

export type TableSection = 'header' | 'body';

/**
 * A table's document-level position and raw text.
 * Produced by Lezer syntax-tree resolution in tableResolution.
 */
export interface ResolvedTable {
    from: number;
    to: number;
    text: string;
}

/**
 * Coordinates identifying a cell within a table.
 * Used to group (section, row, col) into a single type-safe object.
 */
export interface CellCoords {
    section: TableSection;
    row: number; // 0-based index (relative to section; header row is always 0)
    col: number; // 0-based index
}

/** Cell-coordinate equality. Two nulls compare equal, matching `isSameActiveCell`. */
export function isSameCellCoords(a: CellCoords | null, b: CellCoords | null): boolean {
    if (a === b) {
        return true;
    }
    if (!a || !b) {
        return false;
    }

    return a.section === b.section && a.row === b.row && a.col === b.col;
}

export interface TableRect {
    minRow: number; // unified row index; header = 0, body = 1+
    maxRow: number;
    minCol: number;
    maxCol: number;
}

/** Size of a table's unified grid, where the header counts as one row. */
export interface TableGridBounds {
    totalRows: number;
    totalCols: number;
}

export function toUnifiedRowIndex(section: TableSection, row: number): number {
    return section === 'header' ? 0 : row + 1;
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

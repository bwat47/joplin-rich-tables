/**
 * Shared types for table cell coordinates and grid geometry.
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
 * Pins a header cell's section-relative row to 0.
 *
 * Markdown tables have a single header row. Call this at ingresses that accept
 * `CellCoords` from outside the model so a stale non-zero header row cannot leak
 * into editor state.
 */
export function normalizeCellCoords(coords: CellCoords): CellCoords {
    return {
        section: coords.section,
        row: coords.section === 'header' ? 0 : coords.row,
        col: coords.col,
    };
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
 * Converts `CellCoords` to its unified row index. Convenience wrapper over
 * `toUnifiedRowIndex` for the common case of a whole coordinate.
 */
export function toUnifiedRow(coords: CellCoords): number {
    return toUnifiedRowIndex(coords.section, coords.row);
}

/** Inverse of `toUnifiedRow`: splits a unified row index back into section-relative coords. */
export function fromUnifiedRow(row: number, col: number): CellCoords {
    if (row <= 0) {
        return { section: 'header', row: 0, col };
    }

    return { section: 'body', row: row - 1, col };
}

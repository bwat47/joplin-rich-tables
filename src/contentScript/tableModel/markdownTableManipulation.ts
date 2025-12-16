import type { TableData } from './markdownTableParsing';

/**
 * Creates an empty row with the same number of columns as the table header.
 */
function createEmptyRow(columnCount: number): string[] {
    return new Array(columnCount).fill('');
}

function getColumnCount(table: TableData): number {
    let maxCols = Math.max(table.headers.length, table.alignments.length);
    for (const row of table.rows) {
        maxCols = Math.max(maxCols, row.length);
    }
    return maxCols;
}

function padArrayToLength<T>(arr: T[], length: number, filler: T): T[] {
    if (arr.length >= length) {
        return arr;
    }
    return [...arr, ...new Array(length - arr.length).fill(filler)];
}

function normalizeTableColumns(table: TableData): TableData {
    const columnCount = getColumnCount(table);
    if (
        columnCount === table.headers.length &&
        columnCount === table.alignments.length &&
        table.rows.every((r) => r.length === columnCount)
    ) {
        return table;
    }

    const headers = padArrayToLength([...table.headers], columnCount, '');
    const alignments = padArrayToLength([...table.alignments], columnCount, null);
    const rows = table.rows.map((row) => padArrayToLength([...row], columnCount, ''));

    return { headers, alignments, rows };
}

export function insertRow(table: TableData, rowIndex: number, where: 'before' | 'after'): TableData {
    const normalized = normalizeTableColumns(table);
    const newRow = createEmptyRow(getColumnCount(normalized));
    const newRows = [...normalized.rows];

    // rowIndex is 0-based index of the body rows
    const targetIndex = where === 'before' ? rowIndex : rowIndex + 1;

    // Clamp index
    const actualIndex = Math.max(0, Math.min(targetIndex, newRows.length));

    newRows.splice(actualIndex, 0, newRow);

    return {
        ...normalized,
        rows: newRows,
    };
}

export function deleteRow(table: TableData, rowIndex: number): TableData {
    // Don't allow deleting the last remaining body row.
    // A markdown table with only a header row is a valid syntax, but this plugin
    // expects at least one body row for interactive editing semantics.
    if (table.rows.length <= 1) {
        return table;
    }

    if (rowIndex < 0 || rowIndex >= table.rows.length) {
        return table;
    }

    const newRows = [...table.rows];
    newRows.splice(rowIndex, 1);

    return {
        ...table,
        rows: newRows,
    };
}

export function insertColumn(table: TableData, colIndex: number, where: 'before' | 'after'): TableData {
    const normalized = normalizeTableColumns(table);
    const columnCount = getColumnCount(normalized);

    const targetIndex = where === 'before' ? colIndex : colIndex + 1;

    // Clamp index
    const actualIndex = Math.max(0, Math.min(targetIndex, columnCount));

    // Update headers
    const newHeaders = [...normalized.headers];
    newHeaders.splice(actualIndex, 0, '');

    // Update alignments
    const newAlignments = [...normalized.alignments];
    newAlignments.splice(actualIndex, 0, null);

    // Update rows
    const newRows = normalized.rows.map((row) => {
        const newRow = [...row];
        newRow.splice(actualIndex, 0, '');
        return newRow;
    });

    return {
        headers: newHeaders,
        alignments: newAlignments,
        rows: newRows,
    };
}

export function deleteColumn(table: TableData, colIndex: number): TableData {
    const columnCount = getColumnCount(table);

    // Don't allow deleting the last remaining column.
    if (columnCount <= 1) {
        return table;
    }

    if (colIndex < 0 || colIndex >= columnCount) {
        return table;
    }

    // Column deletes operate on the effective table width (max of header/alignments/row lengths).
    // If the source is inconsistent, we treat missing header/alignments cells as empty and
    // preserve the extra columns rather than dropping them during serialization.

    const normalized = normalizeTableColumns(table);

    const newHeaders = [...normalized.headers];
    newHeaders.splice(colIndex, 1);

    const newAlignments = [...normalized.alignments];
    newAlignments.splice(colIndex, 1);

    const newRows = normalized.rows.map((row) => {
        const newRow = [...row];
        newRow.splice(colIndex, 1);
        return newRow;
    });

    return {
        headers: newHeaders,
        alignments: newAlignments,
        rows: newRows,
    };
}

export function updateColumnAlignment(
    table: TableData,
    colIndex: number,
    alignment: 'left' | 'center' | 'right' | null
): TableData {
    const normalized = normalizeTableColumns(table);

    if (colIndex < 0 || colIndex >= normalized.alignments.length) {
        return table;
    }

    const newAlignments = [...normalized.alignments];
    newAlignments[colIndex] = alignment;

    return {
        ...normalized,
        alignments: newAlignments,
    };
}

/**
 * Serializes the TableData back to a Markdown table string.
 * It normalizes to a minimal format: exactly one space after each starting pipe
 * and one space before each ending pipe, with no additional pretty alignment.
 */
export function serializeTable(table: TableData): string {
    const normalized = normalizeTableColumns(table);

    const joinRow = (cells: string[]): string => {
        // Keep cell text as-is; only enforce one space around the pipe separators.
        // This intentionally does not try to align columns via additional padding.
        return '| ' + cells.join(' | ') + ' |';
    };

    const separatorCellForAlignment = (align: 'left' | 'right' | 'center' | null): string => {
        // Markdown requires at least 3 dashes.
        if (align === 'center') return ':---:';
        if (align === 'left') return ':---';
        if (align === 'right') return '---:';
        return '---';
    };

    // 2. Build Header
    const headerLine = joinRow(normalized.headers);

    // 3. Build Separator
    const separatorCells = normalized.alignments.map(separatorCellForAlignment);
    const separatorLine = joinRow(separatorCells);

    // 4. Build Body
    const bodyLines = normalized.rows.map((row) => joinRow(row));

    return [headerLine, separatorLine, ...bodyLines].join('\n');
}

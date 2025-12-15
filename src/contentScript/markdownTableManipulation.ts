import type { TableData } from './markdownTableParsing';

/**
 * Creates an empty row with the same number of columns as the table header.
 */
function createEmptyRow(columnCount: number): string[] {
    return new Array(columnCount).fill('');
}

export function insertRow(table: TableData, rowIndex: number, where: 'before' | 'after'): TableData {
    const newRow = createEmptyRow(table.headers.length);
    const newRows = [...table.rows];

    // rowIndex is 0-based index of the body rows
    const targetIndex = where === 'before' ? rowIndex : rowIndex + 1;

    // Clamp index
    const actualIndex = Math.max(0, Math.min(targetIndex, newRows.length));

    newRows.splice(actualIndex, 0, newRow);

    return {
        ...table,
        rows: newRows,
    };
}

export function deleteRow(table: TableData, rowIndex: number): TableData {
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
    const targetIndex = where === 'before' ? colIndex : colIndex + 1;

    // Clamp index
    const actualIndex = Math.max(0, Math.min(targetIndex, table.headers.length));

    // Update headers
    const newHeaders = [...table.headers];
    newHeaders.splice(actualIndex, 0, 'New Col');

    // Update alignments
    const newAlignments = [...table.alignments];
    newAlignments.splice(actualIndex, 0, null);

    // Update rows
    const newRows = table.rows.map((row) => {
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
    if (colIndex < 0 || colIndex >= table.headers.length) {
        return table;
    }

    // Prevent deleting the last column?
    // Usually tables should have at least one column, but empty tables are possible.

    const newHeaders = [...table.headers];
    newHeaders.splice(colIndex, 1);

    const newAlignments = [...table.alignments];
    newAlignments.splice(colIndex, 1);

    const newRows = table.rows.map((row) => {
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

/**
 * Serializes the TableData back to a Markdown table string.
 * It attempts to align columns by padding with spaces.
 */
export function serializeTable(table: TableData): string {
    // 1. Calculate column widths
    const colWidths = table.headers.map((h) => h.length);

    // Check alignments row
    // Alignment row usually looks like ---, :---, :---:, ---:
    // Minimum width for alignment is 3.
    for (let i = 0; i < colWidths.length; i++) {
        colWidths[i] = Math.max(colWidths[i], 3);
    }

    // Check body rows
    for (const row of table.rows) {
        for (let i = 0; i < row.length; i++) {
            // If row has more cells than headers, ignore extras for width calc (or expand?)
            // Usually we assume consistent structure.
            if (i < colWidths.length) {
                colWidths[i] = Math.max(colWidths[i], row[i].length);
            }
        }
    }

    // Helper to pad cell
    const pad = (text: string, width: number, _align: 'left' | 'right' | 'center' | null) => {
        // For simplicity, we just right-pad everything unless it's strictly numeric maybe?
        // Standard Markdown usually just pads with spaces to fill the cell.
        // alignment only affects the separator row `:-:` syntax, but visual padding aids readability.
        return text + ' '.repeat(Math.max(0, width - text.length));
    };

    // 2. Build Header
    const headerCells = table.headers.map((h, i) => pad(h, colWidths[i], null));
    const headerLine = '| ' + headerCells.join(' | ') + ' |';

    // 3. Build Separator
    const separatorCells = table.alignments.map((align, i) => {
        const width = colWidths[i];
        let sep = '-'.repeat(width);

        // Adjust for colons
        if (align === 'center') {
            sep = ':' + '-'.repeat(width - 2) + ':';
        } else if (align === 'left') {
            sep = ':' + '-'.repeat(width - 1);
        } else if (align === 'right') {
            sep = '-'.repeat(width - 1) + ':';
        }
        return sep;
    });
    const separatorLine = '| ' + separatorCells.join(' | ') + ' |';

    // 4. Build Body
    const bodyLines = table.rows.map((row) => {
        // Ensure row has enough cells (pad with empty if missing)
        const rowCells: string[] = [];
        for (let i = 0; i < table.headers.length; i++) {
            const cellText = row[i] || '';
            rowCells.push(pad(cellText, colWidths[i], null));
        }
        return '| ' + rowCells.join(' | ') + ' |';
    });

    return [headerLine, separatorLine, ...bodyLines].join('\n');
}

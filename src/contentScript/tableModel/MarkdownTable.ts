import { computeMarkdownTableCellRanges, isSeparatorRow } from './markdownTableCellRanges';
import { scanMarkdownTableRow } from './markdownTableRowScanner';
import { normalizeBrTags } from '../shared/cellTextNormalization';
import { clamp } from '../shared/numberUtils';
import { toUnifiedRowIndex, type CellCoords, type TableRect, type TableSection } from './types';
import { compareRawMarkdownCells, type TableSortDirection } from './rawMarkdownSort';

export type TableAlignment = 'left' | 'center' | 'right' | null;
export interface MarkdownTableParts {
    headerCells: readonly string[];
    alignments: readonly TableAlignment[];
    bodyRows: readonly (readonly string[])[];
}

export interface ClipboardTableFragment {
    cells: readonly (readonly string[])[];
    alignments: readonly TableAlignment[];
}

export interface PasteRectResult {
    table: MarkdownTable;
    pastedRect: TableRect;
}

export interface SortBodyRowsResult {
    table: MarkdownTable;
    /** Maps each original body-row index to its index in the sorted table. */
    sortedIndexByOriginalIndex: readonly number[];
}

function parseAlignment(cell: string): TableAlignment {
    const trimmed = cell.trim();
    const left = trimmed.startsWith(':');
    const right = trimmed.endsWith(':');

    if (left && right) return 'center';
    if (left) return 'left';
    if (right) return 'right';
    return null;
}

function parseSeparatorRow(line: string): string[] {
    const trimmed = line.trim();
    const { delimiters: allDelimiters } = scanMarkdownTableRow(trimmed);

    let innerFrom = 0;
    let innerTo = trimmed.length;

    if (allDelimiters.length > 0 && allDelimiters[0] === 0) {
        innerFrom += 1;
    }
    if (allDelimiters.length > 0 && allDelimiters[allDelimiters.length - 1] === trimmed.length - 1) {
        innerTo -= 1;
    }

    const delimiters = allDelimiters.filter((index) => index > innerFrom && index < innerTo);

    const cells: string[] = [];
    let segmentStart = innerFrom;
    for (const delimiterIndex of delimiters) {
        cells.push(trimmed.slice(segmentStart, delimiterIndex).trim());
        segmentStart = delimiterIndex + 1;
    }
    cells.push(trimmed.slice(segmentStart, innerTo).trim());

    return cells;
}

function cloneRows(rows: readonly (readonly string[])[]): string[][] {
    return rows.map((row) => [...row]);
}

function padArrayToLength<T>(arr: readonly T[], length: number, filler: T): T[] {
    if (arr.length >= length) {
        return [...arr];
    }

    return [...arr, ...new Array(length - arr.length).fill(filler)];
}

function getColumnCount(
    headers: readonly string[],
    alignments: readonly TableAlignment[],
    rows: readonly (readonly string[])[]
): number {
    let maxCols = Math.max(headers.length, alignments.length);
    for (const row of rows) {
        maxCols = Math.max(maxCols, row.length);
    }
    return maxCols;
}

function normalizeState(input: {
    headerCells: readonly string[];
    alignments: readonly TableAlignment[];
    bodyRows: readonly (readonly string[])[];
}): { headers: string[]; alignments: TableAlignment[]; rows: string[][] } {
    const columnCount = getColumnCount(input.headerCells, input.alignments, input.bodyRows);

    return {
        headers: padArrayToLength(input.headerCells, columnCount, ''),
        alignments: padArrayToLength(input.alignments, columnCount, null),
        rows: input.bodyRows.map((row) => padArrayToLength(row, columnCount, '')),
    };
}

function createEmptyRow(columnCount: number): string[] {
    return new Array(columnCount).fill('');
}

function cloneUnifiedRows(headers: readonly string[], rows: readonly (readonly string[])[]): string[][] {
    return [[...headers], ...cloneRows(rows)];
}

function createFromUnifiedRows(
    allRows: readonly (readonly string[])[],
    alignments: readonly TableAlignment[]
): MarkdownTable | null {
    const [headerCells, ...bodyRows] = allRows;
    if (!headerCells) {
        return null;
    }

    return MarkdownTable.fromParts({
        headerCells,
        alignments,
        bodyRows,
    });
}

export type RowMoveDirection = 'up' | 'down';

/** Unified-row index delta applied by `moveRow` for each direction. */
const ROW_MOVE_OFFSETS: Record<RowMoveDirection, number> = {
    up: -1,
    down: 1,
};

/** Placement of a clipboard fragment inside the unified grid, in unified coordinates. */
interface PasteGeometry {
    anchorRow: number;
    anchorCol: number;
    rowCount: number;
    colCount: number;
}

function isRectangularFragment(cells: readonly (readonly string[])[], colCount: number): boolean {
    return colCount > 0 && cells.every((row) => row.length === colCount);
}

/**
 * Resolves where a clipboard fragment lands in the unified grid, or `null` when the
 * anchor is out of bounds or the fragment is empty/ragged.
 */
function resolvePasteGeometry(anchor: CellCoords, fragment: ClipboardTableFragment): PasteGeometry | null {
    const anchorRow = toUnifiedRowIndex(anchor.section, anchor.row);
    if (anchorRow < 0 || anchor.col < 0) {
        return null;
    }

    const rowCount = fragment.cells.length;
    const colCount = fragment.cells[0]?.length ?? 0;
    if (rowCount <= 0 || !isRectangularFragment(fragment.cells, colCount)) {
        return null;
    }

    return { anchorRow, anchorCol: anchor.col, rowCount, colCount };
}

/** Grows the unified grid in place so every cell of the target rect exists. */
function growUnifiedGrid(rows: string[][], requiredRowCount: number, requiredColCount: number): void {
    while (rows.length < requiredRowCount) {
        rows.push(createEmptyRow(requiredColCount));
    }

    for (const row of rows) {
        while (row.length < requiredColCount) {
            row.push('');
        }
    }
}

/**
 * Extends alignments to cover columns the paste adds, adopting the clipboard alignment
 * for each new column when the fragment supplies one.
 */
function extendAlignmentsForPaste(
    alignments: readonly TableAlignment[],
    requiredColCount: number,
    anchorCol: number,
    fragmentAlignments: readonly TableAlignment[]
): TableAlignment[] {
    const nextAlignments = [...alignments];

    for (let targetCol = nextAlignments.length; targetCol < requiredColCount; targetCol++) {
        nextAlignments.push(fragmentAlignments[targetCol - anchorCol] ?? null);
    }

    return nextAlignments;
}

/** Writes fragment cells into the grown grid, reporting whether any cell value changed. */
function writeFragmentCells(rows: string[][], geometry: PasteGeometry, cells: readonly (readonly string[])[]): boolean {
    let didChange = false;

    for (let rowOffset = 0; rowOffset < geometry.rowCount; rowOffset++) {
        const targetRow = rows[geometry.anchorRow + rowOffset];

        for (let colOffset = 0; colOffset < geometry.colCount; colOffset++) {
            const targetCol = geometry.anchorCol + colOffset;
            const nextValue = cells[rowOffset][colOffset];

            if (targetRow[targetCol] !== nextValue) {
                targetRow[targetCol] = nextValue;
                didChange = true;
            }
        }
    }

    return didChange;
}

function toPastedRect(geometry: PasteGeometry): TableRect {
    return {
        minRow: geometry.anchorRow,
        maxRow: geometry.anchorRow + geometry.rowCount - 1,
        minCol: geometry.anchorCol,
        maxCol: geometry.anchorCol + geometry.colCount - 1,
    };
}

export class MarkdownTable {
    private constructor(
        private readonly headersData: readonly string[],
        private readonly alignmentsData: readonly TableAlignment[],
        private readonly rowsData: readonly (readonly string[])[]
    ) {}

    /**
     * Parses Markdown table text into the canonical normalized model.
     * Cell content extraction is delegated to `computeMarkdownTableCellRanges()`
     * so parsing stays aligned with the source ranges used for editing.
     */
    static parse(text: string): MarkdownTable | null {
        const lines = text.split('\n').filter((line) => line.trim().length > 0);
        if (lines.length < 2) return null;

        if (!lines[0].includes('|')) return null;
        if (!isSeparatorRow(lines[1])) return null;

        const alignments = parseSeparatorRow(lines[1]).map(parseAlignment);
        const ranges = computeMarkdownTableCellRanges(text);
        if (!ranges) {
            return null;
        }

        const headers = ranges.headers.map((range) => text.slice(range.from, range.to));
        const rows = ranges.rows.map((rowRanges) => rowRanges.map((range) => text.slice(range.from, range.to)));

        return MarkdownTable.create({ headerCells: headers, alignments, bodyRows: rows });
    }

    /**
     * Constructs a table directly from parts and normalizes ragged input immediately.
     * Intended for tests, fixtures, and internal callers that already have cell arrays.
     */
    static fromParts(parts: MarkdownTableParts): MarkdownTable {
        return MarkdownTable.create(parts);
    }

    private static create(input: MarkdownTableParts): MarkdownTable {
        const normalized = normalizeState(input);
        return new MarkdownTable(normalized.headers, normalized.alignments, normalized.rows);
    }

    get headerCells(): readonly string[] {
        return [...this.headersData];
    }

    get bodyRows(): readonly (readonly string[])[] {
        return cloneRows(this.rowsData);
    }

    get alignments(): readonly TableAlignment[] {
        return [...this.alignmentsData];
    }

    get columnCount(): number {
        return this.headersData.length;
    }

    get rowCount(): number {
        return 1 + this.rowsData.length;
    }

    private isValidColumnIndex(colIndex: number): boolean {
        return colIndex >= 0 && colIndex < this.columnCount;
    }

    /** Validates a unified row index, where `0` addresses the header and `1..n` body rows. */
    private isValidUnifiedRowIndex(rowIndex: number): boolean {
        return rowIndex >= 0 && rowIndex < this.rowCount;
    }

    private isValidBodyRowIndex(rowIndex: number): boolean {
        return rowIndex >= 0 && rowIndex < this.rowsData.length;
    }

    private getUnifiedRow(rowIndex: number): readonly string[] | null {
        if (rowIndex === 0) {
            return this.headersData;
        }

        const bodyRowIndex = rowIndex - 1;
        return bodyRowIndex >= 0 && bodyRowIndex < this.rowsData.length ? this.rowsData[bodyRowIndex] : null;
    }

    private isValidRect(rect: TableRect): boolean {
        return (
            rect.minRow >= 0 &&
            rect.minCol >= 0 &&
            rect.maxRow < this.rowCount &&
            rect.maxCol < this.columnCount &&
            rect.minRow <= rect.maxRow &&
            rect.minCol <= rect.maxCol
        );
    }

    serialize(): string {
        const joinRow = (cells: readonly string[]) => {
            return '| ' + cells.join(' | ') + ' |';
        };

        const separatorCellForAlignment = (align: TableAlignment): string => {
            if (align === 'center') return ':---:';
            if (align === 'left') return ':---';
            if (align === 'right') return '---:';
            return '---';
        };

        const headerLine = joinRow(this.headersData.map(normalizeBrTags));
        const separatorLine = joinRow(this.alignmentsData.map(separatorCellForAlignment));
        const bodyLines = this.rowsData.map((row) => joinRow(row.map(normalizeBrTags)));

        return [headerLine, separatorLine, ...bodyLines].join('\n');
    }

    insertColumn(colIndex: number, where: 'before' | 'after'): MarkdownTable {
        const targetIndex = where === 'before' ? colIndex : colIndex + 1;
        const actualIndex = clamp(targetIndex, 0, this.columnCount);

        const headers = [...this.headersData];
        headers.splice(actualIndex, 0, '');

        const alignments = [...this.alignmentsData];
        alignments.splice(actualIndex, 0, null);

        const rows = this.rowsData.map((row) => {
            const nextRow = [...row];
            nextRow.splice(actualIndex, 0, '');
            return nextRow;
        });

        return MarkdownTable.create({ headerCells: headers, alignments, bodyRows: rows });
    }

    deleteColumn(colIndex: number): MarkdownTable {
        if (this.columnCount <= 1) {
            return this;
        }

        if (!this.isValidColumnIndex(colIndex)) {
            return this;
        }

        const headers = [...this.headersData];
        headers.splice(colIndex, 1);

        const alignments = [...this.alignmentsData];
        alignments.splice(colIndex, 1);

        const rows = this.rowsData.map((row) => {
            const nextRow = [...row];
            nextRow.splice(colIndex, 1);
            return nextRow;
        });

        return MarkdownTable.create({ headerCells: headers, alignments, bodyRows: rows });
    }

    swapColumns(col1: number, col2: number): MarkdownTable {
        if (!this.isValidColumnIndex(col1) || !this.isValidColumnIndex(col2) || col1 === col2) {
            return this;
        }

        const swapInArray = <T>(arr: readonly T[]) => {
            const nextArr = [...arr];
            [nextArr[col1], nextArr[col2]] = [nextArr[col2], nextArr[col1]];
            return nextArr;
        };

        return MarkdownTable.create({
            headerCells: swapInArray(this.headersData),
            alignments: swapInArray(this.alignmentsData),
            bodyRows: this.rowsData.map(swapInArray),
        });
    }

    updateColumnAlignment(colIndex: number, alignment: TableAlignment): MarkdownTable {
        if (!this.isValidColumnIndex(colIndex)) {
            return this;
        }

        if (this.alignmentsData[colIndex] === alignment) {
            return this;
        }

        const alignments = [...this.alignmentsData];
        alignments[colIndex] = alignment;

        return MarkdownTable.create({
            headerCells: this.headersData,
            alignments,
            bodyRows: this.rowsData,
        });
    }

    clearAllCells(): MarkdownTable {
        const alreadyClear =
            this.headersData.every((cell) => cell === '') &&
            this.rowsData.every((row) => row.every((cell) => cell === ''));
        if (alreadyClear) {
            return this;
        }

        return MarkdownTable.create({
            headerCells: this.headersData.map(() => ''),
            alignments: this.alignmentsData,
            bodyRows: this.rowsData.map((row) => row.map(() => '')),
        });
    }

    clearRow(section: TableSection, rowIndex: number): MarkdownTable {
        if (section === 'header') {
            if (this.headersData.every((cell) => cell === '')) {
                return this;
            }

            return MarkdownTable.create({
                headerCells: this.headersData.map(() => ''),
                alignments: this.alignmentsData,
                bodyRows: this.rowsData,
            });
        }

        if (!this.isValidBodyRowIndex(rowIndex)) {
            return this;
        }

        if (this.rowsData[rowIndex].every((cell) => cell === '')) {
            return this;
        }

        return MarkdownTable.create({
            headerCells: this.headersData,
            alignments: this.alignmentsData,
            bodyRows: this.rowsData.map((row, index) => (index === rowIndex ? row.map(() => '') : [...row])),
        });
    }

    clearColumn(colIndex: number): MarkdownTable {
        if (!this.isValidColumnIndex(colIndex)) {
            return this;
        }

        const alreadyClear = this.headersData[colIndex] === '' && this.rowsData.every((row) => row[colIndex] === '');
        if (alreadyClear) {
            return this;
        }

        const headers = [...this.headersData];
        headers[colIndex] = '';

        const rows = this.rowsData.map((row) => {
            const nextRow = [...row];
            nextRow[colIndex] = '';
            return nextRow;
        });

        return MarkdownTable.create({
            headerCells: headers,
            alignments: this.alignmentsData,
            bodyRows: rows,
        });
    }

    clearRect(rect: TableRect): MarkdownTable {
        if (!this.isValidRect(rect)) {
            return this;
        }

        const nextRows = cloneUnifiedRows(this.headersData, this.rowsData);
        let didChange = false;

        for (let row = rect.minRow; row <= rect.maxRow; row++) {
            for (let col = rect.minCol; col <= rect.maxCol; col++) {
                if (nextRows[row][col] !== '') {
                    nextRows[row][col] = '';
                    didChange = true;
                }
            }
        }

        if (!didChange) {
            return this;
        }

        return createFromUnifiedRows(nextRows, this.alignmentsData) ?? this;
    }

    isRectEmpty(rect: TableRect): boolean {
        if (!this.isValidRect(rect)) {
            return false;
        }

        for (let row = rect.minRow; row <= rect.maxRow; row++) {
            const rowCells = this.getUnifiedRow(row)!;

            for (let col = rect.minCol; col <= rect.maxCol; col++) {
                if (rowCells[col] !== '') {
                    return false;
                }
            }
        }

        return true;
    }

    deleteUnifiedRowRange(minRow: number, maxRow: number): MarkdownTable {
        if (minRow < 0 || maxRow >= this.rowCount || minRow > maxRow) {
            return this;
        }

        const allRows = cloneUnifiedRows(this.headersData, this.rowsData).filter(
            (_row, index) => index < minRow || index > maxRow
        );
        if (allRows.length < 1) {
            return this;
        }

        return createFromUnifiedRows(allRows, this.alignmentsData) ?? this;
    }

    deleteColumnRange(minCol: number, maxCol: number): MarkdownTable {
        if (minCol < 0 || maxCol >= this.columnCount || minCol > maxCol) {
            return this;
        }

        const remainingColumnCount = this.columnCount - (maxCol - minCol + 1);
        if (remainingColumnCount < 1) {
            return this;
        }

        const keepColumn = (_value: string | TableAlignment, index: number) => index < minCol || index > maxCol;

        return MarkdownTable.create({
            headerCells: this.headersData.filter(keepColumn),
            alignments: this.alignmentsData.filter(keepColumn),
            bodyRows: this.rowsData.map((row) => row.filter(keepColumn)),
        });
    }

    /**
     * Overwrites cells with a clipboard fragment anchored at `anchor`, growing the table
     * when the fragment overflows the current bounds. Returns `null` when the anchor is
     * out of bounds or the fragment is empty or ragged.
     */
    pasteFragmentAt(anchor: CellCoords, fragment: ClipboardTableFragment): PasteRectResult | null {
        const geometry = resolvePasteGeometry(anchor, fragment);
        if (!geometry) {
            return null;
        }

        const requiredRowCount = geometry.anchorRow + geometry.rowCount;
        const requiredColCount = geometry.anchorCol + geometry.colCount;
        const didGrow = requiredRowCount > this.rowCount || requiredColCount > this.columnCount;

        const nextRows = cloneUnifiedRows(this.headersData, this.rowsData);
        growUnifiedGrid(nextRows, requiredRowCount, requiredColCount);
        const nextAlignments = extendAlignmentsForPaste(
            this.alignmentsData,
            requiredColCount,
            geometry.anchorCol,
            fragment.alignments
        );

        const didWrite = writeFragmentCells(nextRows, geometry, fragment.cells);
        const didChange = didGrow || didWrite;
        const table = didChange ? (createFromUnifiedRows(nextRows, nextAlignments) ?? this) : this;

        return { table, pastedRect: toPastedRect(geometry) };
    }

    /**
     * Inserts a row relative to the addressed row within the given section.
     * Header-row semantics:
     * - insert before header: create a new empty header and demote the old header to body row 0
     * - insert after header: insert a new empty body row at body row 0
     */
    insertRowRelativeTo(section: TableSection, rowIndex: number, where: 'before' | 'after'): MarkdownTable {
        if (section === 'header') {
            if (where === 'after') {
                return MarkdownTable.create({
                    headerCells: this.headersData,
                    alignments: this.alignmentsData,
                    bodyRows: [createEmptyRow(this.columnCount), ...cloneRows(this.rowsData)],
                });
            }

            return MarkdownTable.create({
                headerCells: createEmptyRow(this.columnCount),
                alignments: this.alignmentsData,
                bodyRows: [[...this.headersData], ...cloneRows(this.rowsData)],
            });
        }

        const targetIndex = where === 'before' ? rowIndex : rowIndex + 1;
        const actualIndex = clamp(targetIndex, 0, this.rowsData.length);
        const rows = cloneRows(this.rowsData);
        rows.splice(actualIndex, 0, createEmptyRow(this.columnCount));

        return MarkdownTable.create({
            headerCells: this.headersData,
            alignments: this.alignmentsData,
            bodyRows: rows,
        });
    }

    /**
     * Deletes the addressed row within the given section.
     * Deleting the header promotes body row 0 to header, but the operation is blocked
     * when that would remove the entire table.
     */
    deleteRowAt(section: TableSection, rowIndex: number): MarkdownTable {
        if (section === 'header') {
            if (this.rowsData.length === 0) {
                return this;
            }

            const [newHeader, ...remainingRows] = cloneRows(this.rowsData);
            return MarkdownTable.create({
                headerCells: newHeader,
                alignments: this.alignmentsData,
                bodyRows: remainingRows,
            });
        }

        if (!this.isValidBodyRowIndex(rowIndex)) {
            return this;
        }

        const rows = cloneRows(this.rowsData);
        rows.splice(rowIndex, 1);

        return MarkdownTable.create({
            headerCells: this.headersData,
            alignments: this.alignmentsData,
            bodyRows: rows,
        });
    }

    /** Whether `section`/`rowIndex` addresses a row that `moveRow` is allowed to relocate. */
    private isMovableRowAddress(section: TableSection, rowIndex: number): boolean {
        if (this.rowsData.length === 0) {
            return false;
        }

        return section === 'header' ? rowIndex === 0 : this.isValidBodyRowIndex(rowIndex);
    }

    /**
     * Moves a row up or down while preserving the current header/body command semantics.
     * Moving the header down swaps it with body row 0; moving the header up is a no-op.
     * Moves past the first or last row are no-ops, enforced by `swapRows` bounds checking.
     */
    moveRow(section: TableSection, rowIndex: number, direction: RowMoveDirection): MarkdownTable {
        if (!this.isMovableRowAddress(section, rowIndex)) {
            return this;
        }

        const currentRowIndex = toUnifiedRowIndex(section, rowIndex);

        return this.swapRows(currentRowIndex, currentRowIndex + ROW_MOVE_OFFSETS[direction]);
    }

    /**
     * Swaps rows using unified row indexes: `0` addresses the header and `1..n`
     * address body rows.
     */
    swapRows(row1: number, row2: number): MarkdownTable {
        if (!this.isValidUnifiedRowIndex(row1) || !this.isValidUnifiedRowIndex(row2) || row1 === row2) {
            return this;
        }

        const allRows = [[...this.headersData], ...cloneRows(this.rowsData)];

        [allRows[row1], allRows[row2]] = [allRows[row2], allRows[row1]];

        return MarkdownTable.create({
            headerCells: allRows[0],
            alignments: this.alignmentsData,
            bodyRows: allRows.slice(1),
        });
    }

    /**
     * Stably sorts body rows by the raw Markdown in `colIndex`, leaving the header fixed.
     * The returned index map lets callers keep a specific row active after the rewrite.
     */
    sortBodyRowsByColumn(colIndex: number, direction: TableSortDirection): SortBodyRowsResult {
        const identityMap = this.rowsData.map((_row, index) => index);
        if (!this.isValidColumnIndex(colIndex) || this.rowsData.length < 2) {
            return { table: this, sortedIndexByOriginalIndex: identityMap };
        }

        const sortedRows = this.rowsData
            .map((row, originalIndex) => ({ row, originalIndex }))
            .sort((a, b) => {
                const result = compareRawMarkdownCells(a.row[colIndex], b.row[colIndex], direction);
                return result !== 0 ? result : a.originalIndex - b.originalIndex;
            });
        const sortedIndexByOriginalIndex = new Array<number>(this.rowsData.length);
        let didChange = false;
        sortedRows.forEach((entry, sortedIndex) => {
            sortedIndexByOriginalIndex[entry.originalIndex] = sortedIndex;
            didChange ||= entry.originalIndex !== sortedIndex;
        });

        if (!didChange) {
            return { table: this, sortedIndexByOriginalIndex };
        }

        return {
            table: MarkdownTable.create({
                headerCells: this.headersData,
                alignments: this.alignmentsData,
                bodyRows: sortedRows.map(({ row }) => row),
            }),
            sortedIndexByOriginalIndex,
        };
    }
}

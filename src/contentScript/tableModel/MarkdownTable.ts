import { computeMarkdownTableCellRanges, isSeparatorRow } from './markdownTableCellRanges';
import { scanMarkdownTableRow } from './markdownTableRowScanner';
import type { TableSection } from './types';

export type TableAlignment = 'left' | 'center' | 'right' | null;
export interface MarkdownTableParts {
    headerCells: readonly string[];
    alignments: readonly TableAlignment[];
    bodyRows: readonly (readonly string[])[];
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

function getColumnCount(headers: readonly string[], alignments: readonly TableAlignment[], rows: readonly (readonly string[])[]): number {
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

export class MarkdownTable {
    private constructor(
        private readonly headersData: readonly string[],
        private readonly alignmentsData: readonly TableAlignment[],
        private readonly rowsData: readonly (readonly string[])[]
    ) {}

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

        const headerLine = joinRow(this.headersData);
        const separatorLine = joinRow(this.alignmentsData.map(separatorCellForAlignment));
        const bodyLines = this.rowsData.map((row) => joinRow(row));

        return [headerLine, separatorLine, ...bodyLines].join('\n');
    }

    insertColumn(colIndex: number, where: 'before' | 'after'): MarkdownTable {
        const targetIndex = where === 'before' ? colIndex : colIndex + 1;
        const actualIndex = Math.max(0, Math.min(targetIndex, this.columnCount));

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

        if (colIndex < 0 || colIndex >= this.columnCount) {
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
        if (col1 < 0 || col1 >= this.columnCount || col2 < 0 || col2 >= this.columnCount || col1 === col2) {
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
        if (colIndex < 0 || colIndex >= this.alignmentsData.length) {
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
            this.headersData.every((cell) => cell === '') && this.rowsData.every((row) => row.every((cell) => cell === ''));
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

        if (rowIndex < 0 || rowIndex >= this.rowsData.length) {
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
        if (colIndex < 0 || colIndex >= this.columnCount) {
            return this;
        }

        const alreadyClear =
            this.headersData[colIndex] === '' && this.rowsData.every((row) => row[colIndex] === '');
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
        const actualIndex = Math.max(0, Math.min(targetIndex, this.rowsData.length));
        const rows = cloneRows(this.rowsData);
        rows.splice(actualIndex, 0, createEmptyRow(this.columnCount));

        return MarkdownTable.create({
            headerCells: this.headersData,
            alignments: this.alignmentsData,
            bodyRows: rows,
        });
    }

    deleteRowAt(section: TableSection, rowIndex: number): MarkdownTable {
        if (section === 'header') {
            if (this.rowsData.length <= 1) {
                return this;
            }

            const [newHeader, ...remainingRows] = cloneRows(this.rowsData);
            return MarkdownTable.create({
                headerCells: newHeader,
                alignments: this.alignmentsData,
                bodyRows: remainingRows,
            });
        }

        if (this.rowsData.length <= 1 || rowIndex < 0 || rowIndex >= this.rowsData.length) {
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

    moveRow(section: TableSection, rowIndex: number, direction: 'up' | 'down'): MarkdownTable {
        if (this.rowsData.length === 0) {
            return this;
        }

        const currentRowIndex = section === 'header' ? -1 : rowIndex;
        let targetRowIndex: number;

        if (direction === 'up') {
            if (currentRowIndex === -1) {
                return this;
            }
            targetRowIndex = currentRowIndex - 1;
        } else {
            if (currentRowIndex === this.rowsData.length - 1) {
                return this;
            }
            targetRowIndex = currentRowIndex + 1;
        }

        return this.swapRows(currentRowIndex, targetRowIndex);
    }

    swapRows(row1: number, row2: number): MarkdownTable {
        const allRows = [[...this.headersData], ...cloneRows(this.rowsData)];
        const idx1 = row1 + 1;
        const idx2 = row2 + 1;

        if (idx1 < 0 || idx1 >= allRows.length || idx2 < 0 || idx2 >= allRows.length || idx1 === idx2) {
            return this;
        }

        [allRows[idx1], allRows[idx2]] = [allRows[idx2], allRows[idx1]];

        return MarkdownTable.create({
            headerCells: allRows[0],
            alignments: this.alignmentsData,
            bodyRows: allRows.slice(1),
        });
    }
}

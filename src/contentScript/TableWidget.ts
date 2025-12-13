import { WidgetType, EditorView } from '@codemirror/view';

/**
 * Represents a parsed markdown table structure
 */
export interface TableData {
    headers: string[];
    alignments: ('left' | 'center' | 'right' | null)[];
    rows: string[][];
}

/**
 * Widget that renders a markdown table as an interactive HTML table
 */
export class TableWidget extends WidgetType {
    constructor(
        private tableData: TableData,
        private rawText: string
    ) {
        super();
    }

    eq(other: TableWidget): boolean {
        return this.rawText === other.rawText;
    }

    toDOM(_view: EditorView): HTMLElement {
        const container = document.createElement('div');
        container.className = 'cm-table-widget';

        const table = document.createElement('table');
        table.className = 'cm-table-widget-table';

        // Render header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        for (let i = 0; i < this.tableData.headers.length; i++) {
            const th = document.createElement('th');
            th.textContent = this.tableData.headers[i].trim();
            const align = this.tableData.alignments[i];
            if (align) {
                th.style.textAlign = align;
            }
            headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Render body
        const tbody = document.createElement('tbody');
        for (const row of this.tableData.rows) {
            const tr = document.createElement('tr');
            for (let i = 0; i < row.length; i++) {
                const td = document.createElement('td');
                td.textContent = row[i].trim();
                const align = this.tableData.alignments[i];
                if (align) {
                    td.style.textAlign = align;
                }
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        container.appendChild(table);
        return container;
    }

    ignoreEvent(): boolean {
        // Allow events to pass through for future interactivity
        return false;
    }
}

/**
 * Parse alignment from separator row cell
 * Examples: :--- (left), :---: (center), ---: (right), --- (none)
 */
function parseAlignment(cell: string): 'left' | 'center' | 'right' | null {
    const trimmed = cell.trim();
    const left = trimmed.startsWith(':');
    const right = trimmed.endsWith(':');

    if (left && right) return 'center';
    if (left) return 'left';
    if (right) return 'right';
    return null;
}

/**
 * Parse a row of pipe-separated cells
 */
function parseRow(line: string): string[] {
    // Remove leading/trailing pipes and split
    let trimmed = line.trim();
    if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
    if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);

    return trimmed.split('|').map((cell) => cell.trim());
}

/**
 * Check if a line is a valid separator row (contains only dashes, colons, pipes, spaces)
 */
function isSeparatorRow(line: string): boolean {
    const trimmed = line.trim();
    // Must have at least one dash
    if (!trimmed.includes('-')) return false;
    // Should only contain valid separator characters
    return /^[\s|:\-]+$/.test(trimmed);
}

/**
 * Parse markdown table text into structured TableData
 * Returns null if the text is not a valid table
 */
export function parseMarkdownTable(text: string): TableData | null {
    const lines = text.split('\n').filter((line) => line.trim().length > 0);

    if (lines.length < 2) return null;

    // First line should be the header
    const headerLine = lines[0];
    if (!headerLine.includes('|')) return null;

    // Second line should be the separator
    const separatorLine = lines[1];
    if (!isSeparatorRow(separatorLine)) return null;

    const headers = parseRow(headerLine);
    const separatorCells = parseRow(separatorLine);
    const alignments = separatorCells.map(parseAlignment);

    // Parse data rows
    const rows: string[][] = [];
    for (let i = 2; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('|')) {
            rows.push(parseRow(line));
        }
    }

    return { headers, alignments, rows };
}

import { WidgetType, EditorView } from '@codemirror/view';
import { getCached, renderMarkdownAsync } from './markdownRenderer';
import { isSeparatorRow, isUnescapedPipeAt } from './markdownTableCellRanges';

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
 * Supports rendering markdown content inside cells
 */
export class TableWidget extends WidgetType {
    constructor(
        private tableData: TableData,
        private tableText: string,
        private tableFrom: number,
        private tableTo: number
    ) {
        super();
    }

    eq(other: TableWidget): boolean {
        return this.tableText === other.tableText;
    }

    toDOM(view: EditorView): HTMLElement {
        const container = document.createElement('div');
        container.className = 'cm-table-widget';

        // Used by extension-level interaction handlers as a reliable fallback.
        container.dataset.tableFrom = String(this.tableFrom);
        container.dataset.tableTo = String(this.tableTo);

        // Create edit button
        const editButton = document.createElement('button');
        editButton.className = 'cm-table-widget-edit-button';
        editButton.title = 'Edit table';
        editButton.innerHTML = '✏️';
        editButton.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            view.dispatch({ selection: { anchor: this.tableFrom } });
            view.focus();
        });
        container.appendChild(editButton);

        const table = document.createElement('table');
        table.className = 'cm-table-widget-table';

        // Render header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        for (let i = 0; i < this.tableData.headers.length; i++) {
            const th = document.createElement('th');
            th.dataset.section = 'header';
            th.dataset.row = '0';
            th.dataset.col = String(i);

            const content = this.tableData.headers[i].trim();
            this.renderCellContent(th, content);

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
        for (let r = 0; r < this.tableData.rows.length; r++) {
            const row = this.tableData.rows[r];
            const tr = document.createElement('tr');
            for (let c = 0; c < row.length; c++) {
                const td = document.createElement('td');
                td.dataset.section = 'body';
                td.dataset.row = String(r);
                td.dataset.col = String(c);

                const content = row[c].trim();
                this.renderCellContent(td, content);

                const align = this.tableData.alignments[c];
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

    /**
     * Render cell content with markdown support
     * Uses cached HTML if available, otherwise shows text and updates async
     */
    private renderCellContent(cell: HTMLElement, markdown: string): void {
        // Check if we have cached rendered HTML
        const cached = getCached(markdown);
        if (cached !== undefined) {
            cell.innerHTML = cached;
            return;
        }

        // Show raw text initially
        cell.textContent = markdown;

        // Check if content likely contains markdown (optimization)
        if (this.containsMarkdown(markdown)) {
            // Request async rendering and update when ready
            renderMarkdownAsync(markdown, (html) => {
                // Only update if the cell is still in the DOM and content hasn't changed
                if (cell.isConnected && cell.textContent === markdown) {
                    cell.innerHTML = html;
                }
            });
        }
    }

    /**
     * Quick check if content likely contains markdown formatting
     * Avoids unnecessary render requests for plain text
     */
    private containsMarkdown(text: string): boolean {
        // Common markdown patterns
        return (
            text.includes('**') || // bold
            text.includes('__') || // bold
            text.includes('*') || // italic (single asterisk)
            text.includes('_') || // italic (single underscore)
            text.includes('`') || // code
            text.includes('[') || // links
            text.includes('~~') || // strikethrough
            text.includes('![') || // images
            text.includes('<') || // HTML tags
            text.includes('==') // Highlights
        );
    }

    ignoreEvent(): boolean {
        // Events are handled by extension-level domEventHandlers.
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
 * Parse a row of pipe-separated cells, respecting escaped pipes (\|)
 */
function parseRow(line: string): string[] {
    const trimmed = line.trim();

    // Find boundaries (same logic as parseLineCellRanges)
    let innerFrom = 0;
    let innerTo = trimmed.length;

    if (trimmed[innerFrom] === '|' && isUnescapedPipeAt(trimmed, innerFrom)) {
        innerFrom += 1;
    }
    if (innerTo > innerFrom && trimmed[innerTo - 1] === '|' && isUnescapedPipeAt(trimmed, innerTo - 1)) {
        innerTo -= 1;
    }

    // Find unescaped pipe delimiters
    const delimiters: number[] = [];
    for (let i = innerFrom; i < innerTo; i++) {
        if (isUnescapedPipeAt(trimmed, i)) {
            delimiters.push(i);
        }
    }

    // Extract cell contents
    const cells: string[] = [];
    let segmentStart = innerFrom;
    for (const delimiterIndex of delimiters) {
        cells.push(trimmed.slice(segmentStart, delimiterIndex).trim());
        segmentStart = delimiterIndex + 1;
    }
    cells.push(trimmed.slice(segmentStart, innerTo).trim());

    return cells;
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

import { WidgetType, EditorView } from '@codemirror/view';
import { renderer } from './markdownRenderer';
import { cleanupHostedEditors } from './nestedCellEditor';
import type { TableData } from './markdownTableParsing';

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
        const cached = renderer.getCached(markdown);
        if (cached !== undefined) {
            cell.innerHTML = cached;
            return;
        }

        // Show raw text initially
        cell.textContent = markdown;

        // Check if content likely contains markdown (optimization)
        if (this.containsMarkdown(markdown)) {
            // Request async rendering and update when ready
            renderer.renderAsync(markdown, (html) => {
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

    /**
     * Estimated height of the widget in pixels.
     * This is crucial for CodeMirror's scroll position calculations.
     * Without it, CM6 guesses the height, finds the real height on render,
     * and jumps the scroll position.
     */
    get estimatedHeight(): number {
        return this.calculateEstimatedHeight();
    }

    private calculateEstimatedHeight(): number {
        const ROW_HEIGHT_BASE = 35; // Approx px per row (including padding/border)
        const WRAP_CHARS = 60; // Approx chars before wrapping
        const WRAP_HEIGHT = 20; // Additional px per wrapped line
        const IMAGE_HEIGHT = 100; // Approx px per image

        let totalHeight = 0;

        // Header height
        totalHeight += ROW_HEIGHT_BASE;

        // Rows
        for (const row of this.tableData.rows) {
            let maxRowHeight = ROW_HEIGHT_BASE;

            for (const cell of row) {
                let cellHeight = ROW_HEIGHT_BASE;
                const textLength = cell.length;

                // Estimate text wrapping
                if (textLength > WRAP_CHARS) {
                    const extraLines = Math.floor(textLength / WRAP_CHARS);
                    cellHeight += extraLines * WRAP_HEIGHT;
                }

                // Estimate images (naive check)
                const imageCount = (cell.match(/!\[.*?\]\(.*?\)/g) || []).length;
                if (imageCount > 0) {
                    cellHeight += imageCount * IMAGE_HEIGHT;
                }

                if (cellHeight > maxRowHeight) {
                    maxRowHeight = cellHeight;
                }
            }
            totalHeight += maxRowHeight;
        }

        // Add some buffer for container padding
        return totalHeight + 20;
    }

    ignoreEvent(): boolean {
        // Events are handled by extension-level domEventHandlers.
        return false;
    }

    destroy(dom: HTMLElement): void {
        // Ensure any nested editor hosted in this widget is closed when the widget is destroyed.
        // This prevents "orphan" subviews from keeping DOM alive and causing scroll jumps.
        cleanupHostedEditors(dom);
    }
}

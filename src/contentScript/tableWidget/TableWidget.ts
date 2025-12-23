import { WidgetType, EditorView } from '@codemirror/view';
import { renderer } from '../services/markdownRenderer';
import { cleanupHostedEditors } from '../nestedEditor/nestedCellEditor';
import type { TableData } from '../tableModel/markdownTableParsing';
import { tableHeightCache } from './tableHeightCache';
import {
    ATTR_TABLE_FROM,
    CLASS_TABLE_WIDGET,
    CLASS_TABLE_WIDGET_TABLE,
    DATA_COL,
    DATA_ROW,
    DATA_SECTION,
    SECTION_BODY,
    SECTION_HEADER,
    getWidgetSelector,
} from './domHelpers';

/** Associates widget DOM elements with their EditorView for cleanup during destroy. */
const widgetViews = new WeakMap<HTMLElement, EditorView>();

/**
 * Widget that renders a markdown table as an interactive HTML table
 * Supports rendering markdown content inside cells
 */
export class TableWidget extends WidgetType {
    private static readonly pendingHeightMeasure = new WeakSet<HTMLElement>();

    constructor(
        private tableData: TableData,
        private tableText: string,
        private tableFrom: number,
        private tableTo: number
    ) {
        super();
    }

    eq(other: TableWidget): boolean {
        // IMPORTANT: include doc positions in equality.
        // CodeMirror may reuse widget DOM when `eq()` returns true.
        // Our edit button handler closes over `tableFrom`, so if the table shifts
        // (e.g. user inserts a newline above it) but the table text is unchanged,
        // reusing DOM would keep a stale `tableFrom` and the edit button would
        // stop working.
        return (
            this.tableText === other.tableText && this.tableFrom === other.tableFrom && this.tableTo === other.tableTo
        );
    }

    toDOM(view: EditorView): HTMLElement {
        const container = document.createElement('div');
        container.className = CLASS_TABLE_WIDGET;

        // Used by extension-level interaction handlers as a reliable fallback.
        container.setAttribute(`data-${ATTR_TABLE_FROM}`, String(this.tableFrom));

        const table = document.createElement('table');
        table.className = CLASS_TABLE_WIDGET_TABLE;

        // Render header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        for (let i = 0; i < this.tableData.headers.length; i++) {
            const th = document.createElement('th');
            th.dataset[DATA_SECTION] = SECTION_HEADER;
            th.dataset[DATA_ROW] = '0';
            th.dataset[DATA_COL] = String(i);

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
                td.dataset[DATA_SECTION] = SECTION_BODY;
                td.dataset[DATA_ROW] = String(r);
                td.dataset[DATA_COL] = String(c);

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

        // Measure and cache the rendered height so future mounts/rebuilds can provide a more
        // accurate `estimatedHeight`, reducing scroll jumps.
        const measureKey = tableHeightCache.getMeasureKey(this.tableFrom, this.tableText);
        view.requestMeasure({
            read: () => {
                if (!container.isConnected) {
                    return;
                }
                const height = container.getBoundingClientRect().height;
                tableHeightCache.set({ tableFrom: this.tableFrom, tableText: this.tableText, heightPx: height });
            },
            key: measureKey,
        });

        // Store view reference for cleanup when widget is destroyed
        widgetViews.set(container, view);

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

                    // Async rendering can change row/table height after mount.
                    // Schedule a re-measure so the height cache tracks the settled DOM.
                    this.scheduleHeightMeasurementFromCell(cell);
                }
            });
        }
    }

    private scheduleHeightMeasurementFromCell(cell: HTMLElement): void {
        const container = cell.closest(getWidgetSelector()) as HTMLElement | null;
        if (!container) {
            return;
        }

        // Throttle per container to avoid excessive measurements when many cells render.
        if (TableWidget.pendingHeightMeasure.has(container)) {
            return;
        }
        TableWidget.pendingHeightMeasure.add(container);

        requestAnimationFrame(() => {
            TableWidget.pendingHeightMeasure.delete(container);
            const view = EditorView.findFromDOM(container);
            if (!view) {
                return;
            }

            const measureKey = tableHeightCache.getMeasureKey(this.tableFrom, this.tableText);
            view.requestMeasure({
                read: () => {
                    if (!container.isConnected) {
                        return;
                    }
                    const height = container.getBoundingClientRect().height;
                    tableHeightCache.set({ tableFrom: this.tableFrom, tableText: this.tableText, heightPx: height });
                },
                key: measureKey,
            });
        });
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
            text.includes('==') || // Highlights
            text.includes('\\') || // Escaped Text
            text.includes('mailto:') || // Mailto links
            text.includes('#') // Headings
        );
    }

    /**
     * Estimated height of the widget in pixels.
     * This is crucial for CodeMirror's scroll position calculations.
     * Without it, CM6 guesses the height, finds the real height on render,
     * and jumps the scroll position.
     */
    get estimatedHeight(): number {
        const cached = tableHeightCache.get({ tableFrom: this.tableFrom, tableText: this.tableText });
        if (cached !== undefined && cached > 0) {
            return cached;
        }
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
        // Record a last-known height right before teardown. This helps future remounts even if
        // the widget is destroyed before the measurement queue runs.
        const height = dom.getBoundingClientRect().height;
        tableHeightCache.set({ tableFrom: this.tableFrom, tableText: this.tableText, heightPx: height });

        // Ensure any nested editor hosted in this widget is closed when the widget is destroyed.
        // This prevents "orphan" subviews from keeping DOM alive and causing scroll jumps.
        const view = widgetViews.get(dom);
        if (view) {
            cleanupHostedEditors(view, dom);
        }
    }
}

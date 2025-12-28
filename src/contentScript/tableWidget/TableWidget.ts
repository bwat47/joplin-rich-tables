import { WidgetType, EditorView } from '@codemirror/view';
import { renderer } from '../services/markdownRenderer';
import { cleanupHostedEditors } from '../nestedEditor/nestedCellEditor';
import type { TableData } from '../tableModel/markdownTableParsing';
import {
    computeMarkdownTableCellRanges,
    findCellForPos,
    type TableCellRanges,
} from '../tableModel/markdownTableCellRanges';
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
    getCellSelector,
} from './domHelpers';
import { hashTableText } from './hashUtils';
import { estimateTableHeight } from './tableHeightEstimation';
import { unescapePipesForRendering } from '../shared/cellContentUtils';

/** Associates widget DOM elements with their EditorView for cleanup during destroy. */
const widgetViews = new WeakMap<HTMLElement, EditorView>();

/**
 * Widget that renders a markdown table as an interactive HTML table
 * Supports rendering markdown content inside cells
 */
export class TableWidget extends WidgetType {
    private readonly contentHash: string;
    private readonly cellRanges: TableCellRanges | null;
    private resizeObserver: ResizeObserver | null = null;

    constructor(
        private tableData: TableData,
        private tableText: string,
        private tableFrom: number,
        private tableTo: number
    ) {
        super();
        this.contentHash = hashTableText(tableText);
        // Pre-compute cell ranges once, as the table text is immutable for this widget instance
        this.cellRanges = computeMarkdownTableCellRanges(tableText);
    }

    eq(other: TableWidget): boolean {
        // Compare content hash (efficient O(1) vs O(n) string comparison) and position.
        // Position check is critical: when text above table is removed (e.g., undo),
        // CodeMirror may try to reuse widget DOM for a different table at a new position.
        // Without position check, cells would show stale content from the wrong table.
        return this.contentHash === other.contentHash && this.tableFrom === other.tableFrom;
    }

    toDOM(view: EditorView): HTMLElement {
        const container = document.createElement('div');
        container.className = CLASS_TABLE_WIDGET;

        // Used by extension-level interaction handlers as a reliable fallback.
        container.setAttribute(`data-${ATTR_TABLE_FROM}`, String(this.tableFrom));

        // Store content hash for updateDOM() to detect content vs position-only changes.
        container.dataset.tableTextHash = this.contentHash;

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

        // Use ResizeObserver to notify CodeMirror whenever the table height changes.
        // This eliminates the race condition between async rendering and CM6's coordinate system.
        this.resizeObserver = new ResizeObserver(() => {
            // requestMeasure is debounced internally by CM6, so safe to call frequently.
            view.requestMeasure({
                read: () => {
                    if (!container.isConnected) {
                        return;
                    }
                    const height = container.getBoundingClientRect().height;
                    tableHeightCache.set({ tableFrom: this.tableFrom, tableText: this.tableText, heightPx: height });
                },
                key: tableHeightCache.getMeasureKey(this.tableFrom, this.tableText),
            });
        });
        this.resizeObserver.observe(container);

        // Store view reference for cleanup when widget is destroyed
        widgetViews.set(container, view);

        return container;
    }

    /**
     * Render cell content with markdown support
     * Uses cached HTML if available, otherwise shows text and updates async
     */
    private renderCellContent(cell: HTMLElement, markdown: string): void {
        const renderableMarkdown = unescapePipesForRendering(markdown);

        // Check if we have cached rendered HTML
        const cached = renderer.getCached(renderableMarkdown);
        if (cached !== undefined) {
            cell.innerHTML = cached;
            return;
        }

        // Show raw text initially
        cell.textContent = renderableMarkdown;

        // Check if content likely contains markdown (optimization)
        if (this.containsMarkdown(renderableMarkdown)) {
            // Request async rendering and update when ready
            renderer.renderAsync(renderableMarkdown, (html) => {
                // Only update if the cell is still in the DOM and content hasn't changed.
                // Note: Height re-measurement is handled automatically by ResizeObserver.
                if (cell.isConnected && cell.textContent === renderableMarkdown) {
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
        return estimateTableHeight(this.tableData);
    }

    /**
     * Returns the bounding rectangle of the cell containing the given document position.
     * This helps CodeMirror scroll precisely to specific cells rather than just the table bounds.
     */
    coordsAt(
        dom: HTMLElement,
        pos: number,
        _side: number
    ): { top: number; bottom: number; left: number; right: number } | null {
        if (!this.cellRanges) {
            return null;
        }

        const relativePos = pos - this.tableFrom;
        const coords = findCellForPos(this.cellRanges, relativePos);
        if (!coords) {
            return null;
        }

        const cell = dom.querySelector(getCellSelector(coords));
        if (!cell) {
            return null;
        }

        return cell.getBoundingClientRect();
    }

    ignoreEvent(): boolean {
        // Events are handled by extension-level domEventHandlers.
        return false;
    }

    destroy(dom: HTMLElement): void {
        // Disconnect ResizeObserver to prevent memory leaks.
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

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

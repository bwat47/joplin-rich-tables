import { WidgetType, EditorView } from '@codemirror/view';
import { markdownRenderServiceFacet, type MarkdownRenderService } from '../services/markdownRenderer';
import { cleanupHostedNestedEditors } from '../nestedEditor/nestedEditorController';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { findCellForPos, type TableCellRanges } from '../tableModel/markdownTableCellRanges';
import { CLASS_CELL_CONTENT } from '../shared/tableDomClasses';
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
import { estimateTableHeight } from './tableHeightEstimation';
import { buildRenderableContent, containsMarkdown, escapeHtmlPreservingBr } from '../shared/cellContentUtils';
import { getViewDocument, getViewWindow } from '../shared/domContext';
import { logger } from '../../logger';

/** Associates widget DOM elements with their EditorView for cleanup during destroy. */
const widgetViews = new WeakMap<HTMLElement, EditorView>();

/** Associates widget DOM elements with their ResizeObserver for safe DOM reuse. */
const widgetResizeObservers = new WeakMap<HTMLElement, ResizeObserver>();

function getViewResizeObserver(view: EditorView): typeof ResizeObserver {
    return (
        (getViewWindow(view) as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver ?? ResizeObserver
    );
}

function requestTableMeasurement(view: EditorView, container: HTMLElement, tableFrom: number, tableText: string): void {
    view.requestMeasure({
        read: () => {
            if (!container.isConnected) {
                return;
            }

            const currentFrom = Number(container.getAttribute(`data-${ATTR_TABLE_FROM}`)) || tableFrom;
            const height = container.getBoundingClientRect().height;
            tableHeightCache.set({ tableFrom: currentFrom, tableText, heightPx: height });
        },
        key: tableHeightCache.getMeasureKey(tableFrom, tableText),
    });
}

/**
 * Widget that renders a markdown table as an interactive HTML table
 * Supports rendering markdown content inside cells
 */
export class TableWidget extends WidgetType {
    private readonly contentHash: string;
    private readonly cellRanges: TableCellRanges;

    constructor(
        private tableData: MarkdownTable,
        cellRanges: TableCellRanges,
        private tableText: string,
        private tableFrom: number,
        private tableTo: number,
        contentHash: string
    ) {
        super();
        // Hash is pre-computed by the extension to avoid redundant hashing.
        this.contentHash = contentHash;
        this.cellRanges = cellRanges;
    }

    eq(_other: TableWidget): boolean {
        // Always return false to trigger updateDOM() call.
        // updateDOM() will decide whether to reuse the DOM based on content hash.
        return false;
    }

    updateDOM(dom: HTMLElement, view: EditorView): boolean {
        // Called when eq() returns false. We decide here whether to reuse the DOM.
        // Check if the table content is the same by comparing stored hash.
        if (dom.dataset.tableTextHash !== this.contentHash) {
            // Content changed (structural edit) - must rebuild DOM via toDOM().
            return false;
        }

        // Also check if position changed - when positions shift significantly (e.g., undo
        // removes text above table), CodeMirror might incorrectly match DOMs.
        // We update the data attribute to reflect the new position, but we return true (reuse)
        // because the content is the same. This preserves heavy DOM elements like videos.
        const oldFrom = Number(dom.getAttribute(`data-${ATTR_TABLE_FROM}`));
        if (oldFrom !== this.tableFrom) {
            dom.setAttribute(`data-${ATTR_TABLE_FROM}`, String(this.tableFrom));
        }

        // Content and position are the same - safe to reuse the DOM.
        // Update the view mapping so destroy() can clean up correctly.
        widgetViews.set(dom, view);

        // Ensure a ResizeObserver exists for this DOM, even when it was reused.
        if (!widgetResizeObservers.has(dom)) {
            const ResizeObserverCtor = getViewResizeObserver(view);
            const observer = new ResizeObserverCtor(() => {
                requestTableMeasurement(view, dom, this.tableFrom, this.tableText);
            });
            observer.observe(dom);
            widgetResizeObservers.set(dom, observer);
        }

        // Prime CodeMirror's vertical layout info immediately on reuse instead of
        // waiting for ResizeObserver, which may fire too late for the first undo.
        requestTableMeasurement(view, dom, this.tableFrom, this.tableText);

        return true;
    }

    toDOM(view: EditorView): HTMLElement {
        const doc = getViewDocument(view);
        const ResizeObserverCtor = getViewResizeObserver(view);
        const renderer = view.state.facet(markdownRenderServiceFacet);
        const container = doc.createElement('div');
        container.className = CLASS_TABLE_WIDGET;

        // Used by extension-level interaction handlers as a reliable fallback.
        container.setAttribute(`data-${ATTR_TABLE_FROM}`, String(this.tableFrom));

        // Store content hash for updateDOM() to detect content vs position-only changes.
        container.dataset.tableTextHash = this.contentHash;

        const table = doc.createElement('table');
        table.className = CLASS_TABLE_WIDGET_TABLE;
        const headerCells = this.tableData.headerCells;
        const bodyRows = this.tableData.bodyRows;
        const alignments = this.tableData.alignments;

        // Render header — skip synthetic cells that have no source range
        const thead = doc.createElement('thead');
        const headerRow = doc.createElement('tr');
        const headerCount = this.cellRanges.headers.length;
        for (let i = 0; i < headerCount; i++) {
            const th = doc.createElement('th');
            th.dataset[DATA_SECTION] = SECTION_HEADER;
            th.dataset[DATA_ROW] = '0';
            th.dataset[DATA_COL] = String(i);

            const content = headerCells[i];
            this.renderCellContent(th, content, doc, renderer);

            const align = alignments[i];
            if (align) {
                th.style.textAlign = align;
            }
            headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Render body — skip synthetic cells that have no source range
        const tbody = doc.createElement('tbody');
        for (let r = 0; r < bodyRows.length; r++) {
            const row = bodyRows[r];
            const tr = doc.createElement('tr');
            const colCount = this.cellRanges.rows[r]?.length ?? row.length;
            for (let c = 0; c < colCount; c++) {
                const td = doc.createElement('td');
                td.dataset[DATA_SECTION] = SECTION_BODY;
                td.dataset[DATA_ROW] = String(r);
                td.dataset[DATA_COL] = String(c);

                const content = row[c];
                this.renderCellContent(td, content, doc, renderer);

                const align = alignments[c];
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
        const observer = new ResizeObserverCtor(() => {
            // requestMeasure is debounced internally by CM6, so safe to call frequently.
            requestTableMeasurement(view, container, this.tableFrom, this.tableText);
        });
        observer.observe(container);
        widgetResizeObservers.set(container, observer);

        // Store view reference for cleanup when widget is destroyed
        widgetViews.set(container, view);
        // Prime the measurement immediately on mount so the first scroll-preserving
        // undo/redo in a fresh note uses real widget geometry instead of estimates.
        requestTableMeasurement(view, container, this.tableFrom, this.tableText);

        return container;
    }

    /**
     * Render cell content with markdown support
     * Uses cached HTML if available, otherwise shows text and updates async
     */
    private renderCellContent(
        cell: HTMLElement,
        markdown: string,
        doc: Document,
        renderer: MarkdownRenderService
    ): void {
        const { displayText, cacheKey } = buildRenderableContent(markdown);

        // Create a wrapper div for the content. This matches the structure ensureCellWrapper()
        // creates on activation, ensuring CSS rules (like white-space: normal) apply consistently.
        const contentWrapper = doc.createElement('div');
        contentWrapper.className = CLASS_CELL_CONTENT;
        cell.appendChild(contentWrapper);

        // Check if we have cached rendered HTML (keyed by content WITH context)
        const cached = renderer.getCached(cacheKey);
        if (cached !== undefined) {
            contentWrapper.innerHTML = cached;
            return;
        }

        // Show content with <br> rendered as line breaks while async render runs
        contentWrapper.innerHTML = escapeHtmlPreservingBr(displayText);

        // Check if content likely contains markdown (optimization)
        if (containsMarkdown(cacheKey)) {
            // Request async rendering and update when ready
            void renderer
                .render(cacheKey)
                .then((html) => {
                    // Only update if the wrapper is still in the DOM.
                    // Note: Height re-measurement is handled automatically by ResizeObserver.
                    if (contentWrapper.isConnected) {
                        contentWrapper.innerHTML = html;
                    }
                })
                .catch((error) => {
                    logger.error('Failed to render table cell markdown:', error);
                });
        }
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
        const observer = widgetResizeObservers.get(dom);
        if (observer) {
            observer.disconnect();
            widgetResizeObservers.delete(dom);
        }

        // Record a last-known height right before teardown. This helps future remounts even if
        // the widget is destroyed before the measurement queue runs.
        const height = dom.getBoundingClientRect().height;
        const currentFrom = Number(dom.getAttribute(`data-${ATTR_TABLE_FROM}`)) || this.tableFrom;
        tableHeightCache.set({ tableFrom: currentFrom, tableText: this.tableText, heightPx: height });

        // Ensure any nested editor hosted in this widget is closed when the widget is destroyed.
        // This prevents "orphan" subviews from keeping DOM alive and causing scroll jumps.
        const view = widgetViews.get(dom);
        if (view) {
            cleanupHostedNestedEditors(view, dom);
        }
    }
}

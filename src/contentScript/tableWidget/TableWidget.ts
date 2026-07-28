import { WidgetType, EditorView } from '@codemirror/view';
import { markdownRenderServiceFacet, type MarkdownRenderService } from '../services/markdownRenderer';
import { cleanupHostedNestedEditors } from '../nestedEditor/nestedEditorController';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { findCellForPos, type TableCellRanges } from '../tableModel/markdownTableCellRanges';
import { CLASS_CELL_ACTIVE, CLASS_CELL_CONTENT } from '../shared/tableDomClasses';
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

/**
 * What a rendered widget root currently represents.
 *
 * A widget root outlives the `TableWidget` instance that built it — CodeMirror hands the same
 * DOM to successive widgets via `updateDOM()`. Anything captured from `this` at mount time is
 * therefore a snapshot that silently goes stale, so per-DOM state lives here instead and
 * `updateDOM()` is its single writer.
 *
 * `tableText` also serves as the reuse test: holding the text rather than a hash keeps the
 * comparison exact, where a collision would silently show stale rows.
 */
interface WidgetDomState {
    view: EditorView;
    observer: ResizeObserver;
    tableText: string;
    tableFrom: number;
}

const widgetDomState = new WeakMap<HTMLElement, WidgetDomState>();

function getViewResizeObserver(view: EditorView): typeof ResizeObserver {
    return (
        (getViewWindow(view) as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver ?? ResizeObserver
    );
}

function requestTableMeasurement(container: HTMLElement): void {
    const state = widgetDomState.get(container);
    if (!state) {
        return;
    }

    state.view.requestMeasure({
        read: () => {
            // Re-read the state: the table may have moved between scheduling and measuring.
            const current = widgetDomState.get(container);
            if (!current || !container.isConnected) {
                return;
            }

            tableHeightCache.set({
                tableFrom: current.tableFrom,
                tableText: current.tableText,
                heightPx: container.getBoundingClientRect().height,
            });
        },
        key: tableHeightCache.getMeasureKey(state.tableFrom, state.tableText),
    });
}

/**
 * Widget that renders a markdown table as an interactive HTML table
 * Supports rendering markdown content inside cells
 */
export class TableWidget extends WidgetType {
    constructor(
        private tableData: MarkdownTable,
        private readonly cellRanges: TableCellRanges,
        private tableText: string,
        private tableFrom: number
    ) {
        super();
    }

    eq(other: TableWidget): boolean {
        // Everything else the widget exposes derives from the source text: `tableData` is
        // MarkdownTable.parse(text) and `cellRanges` is computeMarkdownTableCellRanges(text).
        // Text equality therefore implies the rendered DOM and estimated height match too.
        //
        // `tableFrom` is load-bearing, not defensive: in-cell edits take the `mapDecorations`
        // path, which shifts decoration ranges without rebuilding widgets, so a widget's
        // `tableFrom` drifts from the document. Comparing it routes those tables through
        // updateDOM() to refresh their recorded position.
        return this.tableText === other.tableText && this.tableFrom === other.tableFrom;
    }

    updateDOM(dom: HTMLElement, view: EditorView): boolean {
        // Reached when eq() returned false, i.e. the text or the position changed. A text change
        // needs a full rebuild; a position change can reuse the DOM after refreshing the state
        // that tracks it. This work cannot move into eq() because it has side effects.
        //
        // An unrecognised DOM has no recorded state, so it falls through to a rebuild.
        const state = widgetDomState.get(dom);
        if (!state || state.tableText !== this.tableText) {
            // Content changed (structural edit) - must rebuild DOM via toDOM().
            return false;
        }

        // Only the position changed, so the DOM stays as-is — preserving heavy elements like
        // videos — and the recorded state is advanced to match. This is the single write point.
        state.view = view;
        state.tableFrom = this.tableFrom;
        dom.setAttribute(`data-${ATTR_TABLE_FROM}`, String(this.tableFrom));

        // Prime CodeMirror's vertical layout info immediately on reuse instead of
        // waiting for ResizeObserver, which may fire too late for the first undo.
        requestTableMeasurement(dom);

        return true;
    }

    toDOM(view: EditorView): HTMLElement {
        const doc = getViewDocument(view);
        const ResizeObserverCtor = getViewResizeObserver(view);
        const renderer = view.state.facet(markdownRenderServiceFacet);
        const container = doc.createElement('div');
        container.className = CLASS_TABLE_WIDGET;

        // Mirrors the recorded position for DOM inspection. Written only from widgetDomState,
        // and never read back: interaction handlers resolve identity via posAtDOM() instead;
        // see findTableWidgetElement().
        container.setAttribute(`data-${ATTR_TABLE_FROM}`, String(this.tableFrom));

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
        // The callback deliberately captures nothing but the element: it outlives this widget,
        // and requestTableMeasurement() reads whatever the element currently represents.
        const observer = new ResizeObserverCtor(() => {
            // requestMeasure is debounced internally by CM6, so safe to call frequently.
            requestTableMeasurement(container);
        });

        // Record the state before observing: the observer may fire immediately, and
        // requestTableMeasurement() is a no-op until the element is registered.
        widgetDomState.set(container, {
            view,
            observer,
            tableText: this.tableText,
            tableFrom: this.tableFrom,
        });
        observer.observe(container);

        // Prime the measurement immediately on mount so the first scroll-preserving
        // undo/redo in a fresh note uses real widget geometry instead of estimates.
        requestTableMeasurement(container);

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

        // Check if we have cached rendered HTML for the normalized cell content
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
     * Returns the bounding rectangle of the cell containing the given widget-relative position.
     * This helps CodeMirror scroll precisely to specific cells rather than just the table bounds.
     *
     * CodeMirror subtracts the widget's document start offset before calling this, so `pos` is
     * already relative to the widget — do not subtract `tableFrom` here.
     *
     * `this.cellRanges` reflects the table text as of the last full rebuild. In-cell edits are
     * forwarded through the `mapDecorations` path (see tableDecorationPolicy.ts) precisely so the
     * widget is *not* rebuilt while a nested editor is open, which leaves `cellRanges` stale for
     * the whole editing session. The actively edited cell is the only part of a rendered table
     * with a real cursor, so when one is open we resolve straight to its DOM element (tagged with
     * `CLASS_CELL_ACTIVE`) instead of trusting offsets that may no longer match the live document.
     */
    coordsAt(
        dom: HTMLElement,
        pos: number,
        _side: number
    ): { top: number; bottom: number; left: number; right: number } | null {
        const activeCell = dom.querySelector(`.${CLASS_CELL_ACTIVE}`);
        if (activeCell) {
            return activeCell.getBoundingClientRect();
        }

        const coords = findCellForPos(this.cellRanges, pos);
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
        // After updateDOM() reuses an element, CodeMirror associates it with the newer widget.
        // Read the per-DOM state so cleanup uses the element's current recorded identity.
        const state = widgetDomState.get(dom);
        if (!state) {
            return;
        }

        // Disconnect ResizeObserver to prevent memory leaks.
        state.observer.disconnect();

        // Record a last-known height right before teardown. This helps future remounts even if
        // the widget is destroyed before the measurement queue runs.
        tableHeightCache.set({
            tableFrom: state.tableFrom,
            tableText: state.tableText,
            heightPx: dom.getBoundingClientRect().height,
        });

        widgetDomState.delete(dom);

        // Ensure any nested editor hosted in this widget is closed when the widget is destroyed.
        // This prevents "orphan" subviews from keeping DOM alive and causing scroll jumps.
        cleanupHostedNestedEditors(state.view, dom);
    }
}

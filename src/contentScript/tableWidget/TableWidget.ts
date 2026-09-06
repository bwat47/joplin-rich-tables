import { WidgetType, EditorView } from '@codemirror/view';
import { markdownRenderServiceFacet, type MarkdownRenderService } from '../services/markdownRenderer';
import { cleanupHostedNestedEditors } from '../nestedEditor/nestedEditorController';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { findCellForPos, type TableCellRanges } from '../tableModel/markdownTableCellRanges';
import type { CellCoords } from '../tableModel/types';
import { resolvedActiveCellField } from '../tableRuntime/activeCell/resolvedActiveCell';
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
import { renderCellMarkdownInto } from '../services/renderCellInto';
import { getViewDocument, getViewWindow } from '../shared/domContext';

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

/** The element a selection endpoint sits in, which for a text node is its parent. */
function endpointElement(node: Node): Element | null {
    return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/**
 * True when the browser's own selection lies wholly inside rendered cell content.
 *
 * Such a selection is the browser's to copy: CodeMirror would answer the copy from its own
 * document selection instead, which sits somewhere else entirely - it is empty during a
 * long-press on mobile, so `copiedRange` falls back to copying the caret's whole source line
 * over the top of what the reader actually selected.
 *
 * A whole-table selection is deliberately not covered: its endpoints sit at the widget's own
 * boundary rather than inside a cell, so the main editor keeps copying the table's Markdown.
 */
function isSelectionInsideRenderedCell(event: Event): boolean {
    const target = event.target as Node | null;
    const doc = target && (target.nodeType === Node.DOCUMENT_NODE ? (target as Document) : target.ownerDocument);
    const selection = doc?.getSelection();
    if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) {
        return false;
    }

    const contentSelector = `.${CLASS_CELL_CONTENT}`;
    return Boolean(
        endpointElement(selection.anchorNode)?.closest(contentSelector) &&
        endpointElement(selection.focusNode)?.closest(contentSelector)
    );
}

/**
 * Widget that renders a markdown table as an interactive HTML table
 * Supports rendering markdown content inside cells
 */
export class TableWidget extends WidgetType {
    constructor(
        private readonly tableData: MarkdownTable,
        private readonly cellRanges: TableCellRanges,
        private readonly tableText: string,
        private readonly tableFrom: number
    ) {
        super();
    }

    eq(other: TableWidget): boolean {
        // Everything else the widget exposes derives from the source text through the same
        // Lezer syntax projection. Text equality therefore implies that the normalized model,
        // cell ranges, rendered DOM, and estimated height match too.
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
        // Create a wrapper div for the content. This matches the structure ensureCellWrapper()
        // creates on activation, ensuring CSS rules (like white-space: normal) apply consistently.
        const contentWrapper = doc.createElement('div');
        contentWrapper.className = CLASS_CELL_CONTENT;
        // Native selection must focus the rendered content rather than the outer editor,
        // whose focus handler would replace the browser range with its document caret.
        contentWrapper.tabIndex = -1;
        cell.appendChild(contentWrapper);

        renderCellMarkdownInto(contentWrapper, markdown, renderer);
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
     * Returns cell-level geometry for a position hidden by the table widget. CodeMirror coordinate
     * consumers, such as cursor-positioned tooltips, use this to anchor UI to the corresponding
     * rendered cell rather than the whole table.
     *
     * CodeMirror subtracts the widget's document start offset before calling this, so `pos` is
     * already relative to the widget — do not subtract `tableFrom` here.
     *
     * `this.cellRanges` reflects the table text as of the last full rebuild. In-cell edits are
     * forwarded through the `mapDecorations` path (see tableDecorationPolicy.ts) precisely so the
     * widget is *not* rebuilt while a nested editor is open, which leaves `cellRanges` stale for
     * the whole editing session — long enough for `pos` to resolve to the wrong cell once the
     * edited cell's length changes. `resolveLiveCellCoords()` reads the live ranges instead, so it
     * takes priority whenever it succeeds; the cached ranges remain as the fallback for every
     * widget it does not cover (see there).
     */
    coordsAt(
        dom: HTMLElement,
        pos: number,
        _side: number
    ): { top: number; bottom: number; left: number; right: number } | null {
        const liveCoords = this.resolveLiveCellCoords(dom, pos);
        const coords = liveCoords === undefined ? findCellForPos(this.cellRanges, pos) : liveCoords;
        if (!coords) {
            return null;
        }

        const cell = dom.querySelector(getCellSelector(coords));
        if (!cell) {
            return null;
        }

        return cell.getBoundingClientRect();
    }

    /**
     * Resolves `pos` against the live cell ranges held in `resolvedActiveCellField` rather than
     * the `cellRanges` snapshot captured at the last full rebuild.
     *
     * The field covers exactly the window in which `cellRanges` is frozen: both `mapDecorations`
     * branches require an active cell, and the field re-derives the table's `TableContext` on
     * every `docChanged` — so the current ranges were already computed in the transaction that
     * froze them. This runs inside CodeMirror's synchronous measure phase; re-deriving them from
     * the syntax tree here would parse and slice the document again per call.
     *
     * `undefined` means the live ranges do not cover this widget and the cached ranges are
     * trustworthy (no active cell means no `mapDecorations` window; a widget outside the active
     * table's span never goes stale). `null` is authoritative: the live position is not in a cell.
     */
    private resolveLiveCellCoords(dom: HTMLElement, pos: number): CellCoords | null | undefined {
        const state = widgetDomState.get(dom);
        if (!state) {
            return undefined;
        }

        // Read the field directly rather than through getResolvedActiveCell(): its fallback for
        // states without the field recomputes the context from the syntax tree, which is the
        // measure-phase work this exists to avoid.
        const resolved = state.view.state.field(resolvedActiveCellField, false);
        if (!resolved) {
            return undefined;
        }

        let liveTableFrom: number;
        try {
            // Mirrors findTableWidgetElement()'s posAtDOM-based lookup: avoids trusting any
            // cached position field, which is exactly what's stale here.
            liveTableFrom = state.view.posAtDOM(dom);
        } catch {
            return undefined;
        }

        // Containment rather than `liveTableFrom === ctx.from`: the widget may be a different
        // table than the active one, and comparing spans tolerates any drift between the mapped
        // decoration start and the freshly resolved table start.
        const { ctx } = resolved;
        const docPos = liveTableFrom + pos;
        if (docPos < ctx.from || docPos > ctx.to) {
            return undefined;
        }

        return findCellForPos(ctx.cellRanges, docPos - ctx.from);
    }

    ignoreEvent(event: Event): boolean {
        // A native range inside rendered text belongs to the pending cell gesture, not
        // the outer document selection. Pointer/mouse events use the interaction handlers.
        if (event.type === 'selectionchange') {
            return true;
        }

        return event.type === 'copy' && isSelectionInsideRenderedCell(event);
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

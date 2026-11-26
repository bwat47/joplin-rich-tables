import { markdown } from '@codemirror/lang-markdown';
import type { Extension } from '@codemirror/state';
import { EditorView, type EditorViewConfig } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { vi } from 'vitest';

import type { HostEditorConfig } from '../../contentScriptBridge/hostEditorConfigBridge';
import { nestedEditorPlugin } from '../nestedEditor/nestedEditorController';
import { textFragmentPreservingBr } from '../services/domFragment';
import { hostEditorConfigFacet } from '../services/hostEditorConfig';
import { createMarkdownRenderer, markdownRenderServiceFacet } from '../services/markdownRenderer';
import type { CellCoords } from '../tableModel/types';
import { widgetInteractionHandlers } from '../tableRuntime/interaction/widgetInteraction';
import { nestedEditorLifecyclePlugin } from '../tableRuntime/lifecycle/nestedEditorLifecycle';
import { cellSelectionFocusPlugin } from '../tableRuntime/selection/cellSelectionController';
import { cellSelectionKeyCapturePlugin } from '../tableRuntime/selection/cellSelectionKeymap';
import { activeCellField, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { cellDragField } from '../tableState/cellDragState';
import { cellSelectionField, setCellSelectionEffect, type CellSelection } from '../tableState/cellSelectionState';
import { openCellRequestField } from '../tableState/openCellRequestState';
import { tableContextField } from '../tableState/tableContextField';
import { getCellSelector, SELECTOR_WIDGET } from '../tableWidget/domHelpers';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { createMarkdownState } from './testMarkdownState';
import { htmlFragment } from './testUtils';

/** Nested-editor settings a test can assert against when it does not set its own. */
export const TEST_NESTED_EDITOR_SETTINGS = {
    autoMatchingBraces: true,
    spellcheck: false,
} satisfies HostEditorConfig['nestedEditor'];

/** Host settings for tests that do not exercise a particular toggle. */
export const TEST_HOST_CONFIG = {
    nestedEditor: TEST_NESTED_EDITOR_SETTINGS,
    tableAppearance: {
        zebraStriping: false,
    },
    toolbar: {
        showMoveButtons: true,
        showClearButtons: true,
        showAlignmentButtons: true,
        showDeleteTableButton: true,
        showSortButtons: true,
    },
} satisfies HostEditorConfig;

export interface ResizeObserverStub {
    /** Stubs `ResizeObserver`, dropping the observers of a previous install. Call from `beforeEach`. */
    install(): void;
    /** Fires every observer created since `install`, as a real resize would. */
    trigger(): void;
}

/**
 * jsdom implements no `ResizeObserver`, and `TableWidget` observes its own DOM for height
 * changes, so mounting one throws without this.
 */
export function createResizeObserverStub(): ResizeObserverStub {
    let callbacks: Array<() => void> = [];

    class ResizeObserverMock {
        constructor(callback: () => void) {
            callbacks.push(callback);
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    }

    return {
        install(): void {
            callbacks = [];
            vi.stubGlobal('ResizeObserver', ResizeObserverMock);
        },
        trigger(): void {
            for (const callback of callbacks) {
                callback();
            }
        },
    };
}

/**
 * jsdom implements no layout, so CodeMirror's measuring throws without these. Call once at
 * module scope; both guards are no-ops when a richer stub is already installed.
 */
export function installRangeLayoutStubs(): void {
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- jsdom omits layout APIs declared by lib.dom.
    if (!Range.prototype.getBoundingClientRect) {
        Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
            value: () => ({
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                toJSON: () => ({}),
            }),
        });
    }

    // oxlint-disable-next-line typescript/no-unnecessary-condition -- jsdom omits layout APIs declared by lib.dom.
    if (!Range.prototype.getClientRects) {
        Object.defineProperty(Range.prototype, 'getClientRects', {
            value: () => [],
        });
    }
}

export interface FrameQueue {
    /** Stubs `ResizeObserver` and `requestAnimationFrame`. Call from `beforeEach`. */
    install(): void;
    /**
     * Drains the frame queue, letting queued microtasks run between frames so work the
     * lifecycle schedules as a microtask (opening a requested cell) settles too.
     */
    flush(): Promise<void>;
}

export function createFrameQueue(): FrameQueue {
    let queue: FrameRequestCallback[] = [];
    const resizeObserver = createResizeObserverStub();

    return {
        install(): void {
            queue = [];
            resizeObserver.install();
            vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
                queue.push(callback);
                return queue.length;
            });
        },
        async flush(): Promise<void> {
            await Promise.resolve();
            while (queue.length > 0) {
                const callback = queue.shift();
                callback?.(0);
                await Promise.resolve();
            }
        },
    };
}

/**
 * Resolves after every measure already queued on the view has written its DOM changes.
 *
 * Distinct from waiting a bare animation frame: this settles the queue of one view rather
 * than whatever the next frame happens to run.
 */
export function flushViewMeasure(view: EditorView): Promise<void> {
    return new Promise((resolve) => {
        view.requestMeasure({
            read: () => undefined,
            write: () => resolve(),
        });
    });
}

/**
 * Points `document.activeElement` at an element, which jsdom otherwise only moves through real
 * focus. Redefinable, so a test can move focus again; reset it to `document.body` in `afterEach`
 * or the stub leaks into the next test.
 */
export function setActiveElement(element: Element | null): void {
    Object.defineProperty(document, 'activeElement', {
        configurable: true,
        get: () => element,
    });
}

/**
 * A main editor that renders table widgets and opens nested cell editors. Callers add
 * `history()` when the test drives undo/redo.
 */
export function nestedEditorTestExtensions(...extra: Extension[]): Extension[] {
    return [
        markdown({ extensions: [GFM] }),
        hostEditorConfigFacet.of(TEST_HOST_CONFIG),
        markdownRenderServiceFacet.of(createMarkdownRenderer(async (markup, id) => ({ id, html: markup }))),
        nestedEditorPlugin,
        tableContextField,
        activeCellField,
        openCellRequestField,
        nestedEditorLifecyclePlugin,
        tableDecorationField,
        ...extra,
    ];
}

/** A main editor that owns a cell selection, without the nested-editor lifecycle. */
export function cellSelectionTestExtensions(...extra: Extension[]): Extension[] {
    return [
        markdown({ extensions: [GFM] }),
        tableContextField,
        activeCellField,
        cellSelectionField,
        cellDragField,
        cellSelectionKeyCapturePlugin,
        cellSelectionFocusPlugin,
        ...extra,
    ];
}

/** Dispatches a bubbling, cancelable keydown without changing focus or normalizing the key. */
export function pressKey(target: EventTarget, init: KeyboardEventInit & { key: string }): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
}

export interface EditorViewHarness {
    mountView(config: Omit<EditorViewConfig, 'parent'>): EditorView;
    /**
     * Destroys this harness's views and detaches the parents it created. Suites that append
     * their own elements to the document, or install mocks, still clean those up themselves.
     */
    destroyViews(): void;
}

interface MountedEditorView {
    view: EditorView;
    parent: HTMLElement;
}

/** Creates isolated view tracking for a suite, leaving editor configuration to each caller. */
export function createEditorViewHarness(): EditorViewHarness {
    const mounted: MountedEditorView[] = [];
    return {
        mountView(config): EditorView {
            const parent = document.createElement('div');
            document.body.appendChild(parent);
            const view = new EditorView({ ...config, parent });
            mounted.push({ view, parent });
            return view;
        },
        destroyViews(): void {
            // Newest first, so a view mounted against an earlier one goes before it.
            for (const { view, parent } of mounted.splice(0).reverse()) {
                view.destroy();
                parent.remove();
            }
        },
    };
}

/** The four cells of a mounted 2x2 table, named by section and column. */
export interface MountedTableWidgetCells {
    header0: HTMLTableCellElement;
    header1: HTMLTableCellElement;
    body0: HTMLTableCellElement;
    body1: HTMLTableCellElement;
}

export interface MountedTableWidgetView {
    view: EditorView;
    widget: HTMLElement;
    table: HTMLTableElement;
    cells: MountedTableWidgetCells;
}

export interface TableWidgetViewOptions {
    /** Markdown whose first table has a header row and one body row, each two cells wide. */
    doc: string;
    /**
     * Rendered HTML keyed by the cell markdown it stands for, painted synchronously as a cache
     * hit. Cells left out show their plain text, as a cache miss does before its render lands.
     */
    renderedHtml?: Readonly<Record<string, string>>;
    activeCell?: ActiveCell;
    cellSelection?: CellSelection;
    extensions?: Extension[];
}

/** Reads a cell out of a rendered widget, so tests bind to `TableWidget`'s own attributes. */
function findRenderedCell(widget: HTMLElement, coords: CellCoords): HTMLTableCellElement {
    const cell = widget.querySelector<HTMLTableCellElement>(getCellSelector(coords));
    if (!cell) {
        throw new Error(`Expected a rendered cell at ${JSON.stringify(coords)}`);
    }
    return cell;
}

/**
 * Mounts a main editor whose table widget is rendered by `tableDecorationField` and whose
 * presses and clicks route through `widgetInteractionHandlers`, as production wires them.
 * Events dispatched on the returned cells therefore reach the handlers through CodeMirror.
 *
 * `TableWidget` observes its own size, so callers install {@link createResizeObserverStub}
 * first.
 */
export function mountTableWidgetView(
    harness: EditorViewHarness,
    options: TableWidgetViewOptions
): MountedTableWidgetView {
    const renderedHtml = new Map(Object.entries(options.renderedHtml ?? {}));
    const view = harness.mountView({
        state: createMarkdownState(options.doc, [
            markdownRenderServiceFacet.of({
                getCached: (text) => {
                    const html = renderedHtml.get(text);
                    return html === undefined ? undefined : htmlFragment(html);
                },
                // Declared cells are always cache hits, so a render only runs for the rest,
                // which stay as the plain text the cache miss already painted.
                render: async (text) => textFragmentPreservingBr(text),
                clear: () => {},
            }),
            activeCellField,
            cellSelectionField,
            openCellRequestField,
            tableDecorationField,
            widgetInteractionHandlers,
            ...(options.extensions ?? []),
        ]),
    });

    const effects = [
        ...(options.activeCell ? [setActiveCellEffect.of(options.activeCell)] : []),
        ...(options.cellSelection ? [setCellSelectionEffect.of(options.cellSelection)] : []),
    ];
    if (effects.length > 0) {
        view.dispatch({ effects });
    }

    // Read after the setup dispatch, which can redraw the widget.
    const widget = view.contentDOM.querySelector<HTMLElement>(SELECTOR_WIDGET);
    const table = widget?.querySelector('table');
    if (!widget || !table) {
        throw new Error('Expected tableDecorationField to mount a table widget');
    }

    return {
        view,
        widget,
        table,
        cells: {
            header0: findRenderedCell(widget, { section: 'header', row: 0, col: 0 }),
            header1: findRenderedCell(widget, { section: 'header', row: 0, col: 1 }),
            body0: findRenderedCell(widget, { section: 'body', row: 0, col: 0 }),
            body1: findRenderedCell(widget, { section: 'body', row: 0, col: 1 }),
        },
    };
}

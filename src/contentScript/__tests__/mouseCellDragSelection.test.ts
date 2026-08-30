/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { activeCellField, getActiveCell, setActiveCellEffect } from '../tableState/activeCellState';
import { cellSelectionField, getCellSelection, setCellSelectionEffect } from '../tableState/cellSelectionState';
import { cellDragField, isCellDragInProgress } from '../tableState/cellDragState';
import { getPendingOpenCellRequest, openCellRequestField } from '../tableRuntime/openCellRequest';
import { handleTableInteraction } from '../tableWidget/tableWidgetInteractions';
import { mouseCellDragSelectionPlugin } from '../tableRuntime/interaction/mouseCellDragSelection';
import { canHandleTableSelectionKeydown } from '../tableRuntime/selection/cellSelectionShortcutScope';
import { getCellSelector } from '../tableWidget/domHelpers';
import { TableWidget } from '../tableWidget/TableWidget';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import type { CellCoords } from '../tableModel/types';
import { computeMarkdownTableCellRanges } from '../tableModel/markdownTableCellRanges';
import { markdownRenderServiceFacet } from '../services/markdownRenderer';
import { createMarkdownState } from './testMarkdownState';
import { getResolvedActiveCell, resolvedActiveCellField } from '../tableRuntime/activeCell/resolvedActiveCell';
import { CLASS_CELL_ACTIVE, CLASS_CELL_EDITOR } from '../shared/tableDomClasses';

const GRID_DOC = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');

interface MountedGestureView {
    view: EditorView;
    widget: HTMLElement;
    table: HTMLTableElement;
    cells: {
        header0: HTMLTableCellElement;
        header1: HTMLTableCellElement;
        body0: HTMLTableCellElement;
        body1: HTMLTableCellElement;
    };
}

const mountedViews: EditorView[] = [];
let elementAtPoint: Element | null = null;
let originalElementFromPoint: PropertyDescriptor | undefined;

const POINTER_RELEASE_TYPES = ['pointerup', 'pointercancel'];

function pointerEvent(
    type: string,
    init: MouseEventInit & { pointerId?: number; pointerType?: string; isPrimary?: boolean }
): PointerEvent {
    const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        // Mirror a held primary button unless the caller says otherwise, so `buttons`
        // reflects reality the way a real pointer sequence does.
        buttons: init.buttons ?? (POINTER_RELEASE_TYPES.includes(type) ? 0 : 1),
        ...init,
    });
    Object.defineProperties(event, {
        pointerId: { value: init.pointerId ?? 1 },
        pointerType: { value: init.pointerType ?? 'mouse' },
        isPrimary: { value: init.isPrimary ?? true },
    });
    return event as unknown as PointerEvent;
}

class ResizeObserverMock {
    observe = vi.fn();
    disconnect = vi.fn();
}

/** Reads a cell out of a rendered widget, so tests bind to `TableWidget`'s own attributes. */
function findCell(widget: HTMLElement, coords: CellCoords): HTMLTableCellElement {
    const cell = widget.querySelector(getCellSelector(coords));
    if (!cell) {
        throw new Error(`Expected a rendered cell at ${JSON.stringify(coords)}`);
    }
    return cell as HTMLTableCellElement;
}

function mountGestureView(): MountedGestureView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const view = new EditorView({
        parent,
        state: createMarkdownState(GRID_DOC, [
            markdownRenderServiceFacet.of({
                getCached: vi.fn(() => undefined),
                render: vi.fn(async () => ''),
                clear: vi.fn(),
            }),
            activeCellField,
            resolvedActiveCellField,
            cellSelectionField,
            cellDragField,
            openCellRequestField,
            mouseCellDragSelectionPlugin,
        ]),
    });
    mountedViews.push(view);

    vi.spyOn(view, 'posAtDOM').mockReturnValue(0);

    // The widget is built the way production builds it, so these tests fail if the cell
    // attribute contract the gesture hit-tests against ever changes.
    const table = MarkdownTable.parse(GRID_DOC);
    const cellRanges = computeMarkdownTableCellRanges(GRID_DOC);
    if (!table || !cellRanges) {
        throw new Error('Expected the test table to parse');
    }
    const widget = new TableWidget(table, cellRanges, GRID_DOC, 0).toDOM(view);
    view.dom.appendChild(widget);

    const cells = {
        header0: findCell(widget, { section: 'header', row: 0, col: 0 }),
        header1: findCell(widget, { section: 'header', row: 0, col: 1 }),
        body0: findCell(widget, { section: 'body', row: 0, col: 0 }),
        body1: findCell(widget, { section: 'body', row: 0, col: 1 }),
    };

    view.dom.addEventListener('pointerdown', (event) => {
        handleTableInteraction(view, event);
    });
    view.dom.addEventListener('mousedown', (event) => {
        handleTableInteraction(view, event);
    });
    view.dom.addEventListener('click', (event) => {
        handleTableInteraction(view, event);
    });

    return { view, widget, table: widget.querySelector('table') as HTMLTableElement, cells };
}

function makeRect(left: number, top: number, right: number, bottom: number): DOMRect {
    return {
        x: left,
        y: top,
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
        toJSON: () => ({}),
    };
}

function setScrollDimensions(
    element: HTMLElement,
    dimensions: Partial<Record<'clientWidth' | 'clientHeight' | 'scrollWidth' | 'scrollHeight', number>>
): void {
    for (const [property, value] of Object.entries(dimensions)) {
        Object.defineProperty(element, property, { configurable: true, value });
    }
}

/** Makes the page itself the scroller, the way the web app's external scrolling behaves. */
function makePageScroller(dimensions: { clientHeight: number; scrollHeight: number }): HTMLElement {
    const page = document.documentElement;
    setScrollDimensions(page, dimensions);
    Object.defineProperty(page, 'scrollTop', { configurable: true, writable: true, value: 0 });
    return page;
}

function resetPageScroller(): void {
    for (const property of ['clientHeight', 'scrollHeight', 'scrollTop']) {
        Reflect.deleteProperty(document.documentElement, property);
    }
}

function mockAnimationFrames(): {
    cancelSpy: ReturnType<typeof vi.spyOn>;
    pendingCount: () => number;
    runNext: (timestamp: number) => void;
} {
    let nextId = 1;
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        const id = nextId;
        nextId += 1;
        callbacks.set(id, callback);
        return id;
    });
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
        callbacks.delete(id);
    });

    return {
        cancelSpy,
        pendingCount: () => callbacks.size,
        runNext: (timestamp) => {
            const next = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
            if (!next) {
                throw new Error('Expected a pending animation frame');
            }
            callbacks.delete(next[0]);
            next[1](timestamp);
        },
    };
}

function mountNestedEditorHost(cell: HTMLTableCellElement): HTMLElement {
    cell.classList.add(CLASS_CELL_ACTIVE);
    const host = document.createElement('div');
    host.className = CLASS_CELL_EDITOR;
    const content = document.createElement('div');
    content.setAttribute('contenteditable', 'true');
    host.appendChild(content);
    cell.appendChild(host);
    return content;
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock as unknown as typeof ResizeObserver);
    originalElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
    Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: vi.fn(() => elementAtPoint),
    });
});

afterEach(() => {
    elementAtPoint = null;
    resetPageScroller();
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    if (originalElementFromPoint) {
        Object.defineProperty(document, 'elementFromPoint', originalElementFromPoint);
    } else {
        Reflect.deleteProperty(document, 'elementFromPoint');
    }
});

describe('mouse cell drag selection', () => {
    it('keeps a mouse press provisional and opens the cell when released without dragging', () => {
        const { view, cells } = mountGestureView();
        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'header', row: 0, col: 0 },
                focus: { section: 'header', row: 0, col: 1 },
            }),
        });
        const down = pointerEvent('pointerdown', {
            button: 0,
            clientX: 10,
            clientY: 10,
        });

        cells.body0.dispatchEvent(down);
        expect(down.defaultPrevented).toBe(true);
        expect(getActiveCell(view.state)).toBeNull();
        expect(getCellSelection(view.state)).not.toBeNull();

        const compatibilityMouseDown = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0,
        });
        cells.body0.dispatchEvent(compatibilityMouseDown);
        expect(compatibilityMouseDown.defaultPrevented).toBe(true);
        expect(getActiveCell(view.state)).toBeNull();

        document.dispatchEvent(
            pointerEvent('pointerup', {
                button: 0,
                clientX: 10,
                clientY: 10,
            })
        );

        expect(getActiveCell(view.state)).toMatchObject({
            section: 'body',
            row: 0,
            col: 0,
        });
        expect(getPendingOpenCellRequest(view.state)?.activeCell).toMatchObject({
            section: 'body',
            row: 0,
            col: 0,
        });
        expect(getCellSelection(view.state)).toBeNull();
    });

    it('re-resolves a provisional press when the table moves before release', () => {
        const { view, cells } = mountGestureView();
        cells.body0.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }));

        // The gesture recorded tableFrom 0 on pointerdown; pushing the table down the document
        // makes that stale, so no rectangle can be dispatched.
        const prefix = 'prose\n\n';
        view.dispatch({ changes: { from: 0, insert: prefix } });
        vi.mocked(view.posAtDOM).mockReturnValue(prefix.length);

        elementAtPoint = cells.body1;
        const drag = pointerEvent('pointermove', { button: 0, clientX: 20, clientY: 20 });
        document.dispatchEvent(drag);

        expect(getCellSelection(view.state)).toBeNull();
        expect(drag.defaultPrevented).toBe(false);

        document.dispatchEvent(pointerEvent('pointerup', { button: 0, clientX: 20, clientY: 20 }));

        expect(view.state.doc.toString()).toBe(`${prefix}${GRID_DOC}\n`);
        expect(getPendingOpenCellRequest(view.state)?.activeCell).toEqual({
            tableFrom: prefix.length,
            section: 'body',
            row: 0,
            col: 0,
        });
        expect(getResolvedActiveCell(view.state)?.tableFrom).toBe(prefix.length);
    });

    it('abandons a provisional press when its widget no longer identifies a table', () => {
        const { view, cells } = mountGestureView();
        cells.body0.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }));

        const prefix = 'prose\n\n';
        view.dispatch({ changes: { from: 0, insert: prefix } });

        elementAtPoint = cells.body1;
        document.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 20, clientY: 20 }));
        document.dispatchEvent(pointerEvent('pointerup', { button: 0, clientX: 20, clientY: 20 }));

        expect(view.state.doc.toString()).toBe(`${prefix}${GRID_DOC}`);
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
        expect(getActiveCell(view.state)).toBeNull();
    });

    it('starts a rectangular selection after the mouse crosses the movement threshold', () => {
        const { view, cells } = mountGestureView();
        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'body', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });
        cells.header0.dispatchEvent(
            pointerEvent('pointerdown', {
                button: 0,
                clientX: 10,
                clientY: 10,
            })
        );

        elementAtPoint = cells.body1;
        const belowThreshold = pointerEvent('pointermove', {
            button: 0,
            clientX: 13,
            clientY: 13,
        });
        document.dispatchEvent(belowThreshold);
        expect(belowThreshold.defaultPrevented).toBe(false);
        expect(getCellSelection(view.state)?.anchor).toEqual({
            section: 'body',
            row: 0,
            col: 0,
        });

        const drag = pointerEvent('pointermove', {
            button: 0,
            clientX: 20,
            clientY: 20,
        });
        document.dispatchEvent(drag);

        expect(drag.defaultPrevented).toBe(true);
        expect(getCellSelection(view.state)).toEqual({
            tableFrom: 0,
            anchor: { section: 'header', row: 0, col: 0 },
            focus: { section: 'body', row: 0, col: 1 },
        });
        expect(getActiveCell(view.state)).toBeNull();

        document.dispatchEvent(
            pointerEvent('pointerup', {
                button: 0,
                clientX: 20,
                clientY: 20,
            })
        );

        expect(getCellSelection(view.state)).not.toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('focuses the main editor when a drag selection completes from outside editor focus', () => {
        const { view, cells } = mountGestureView();
        const externalInput = document.createElement('input');
        document.body.appendChild(externalInput);
        externalInput.focus();

        cells.header0.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }));
        elementAtPoint = cells.body1;
        document.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 20, clientY: 20 }));

        expect(document.activeElement).toBe(externalInput);
        expect(canHandleTableSelectionKeydown(view)).toBe(false);

        document.dispatchEvent(pointerEvent('pointerup', { button: 0, clientX: 20, clientY: 20 }));

        expect(getCellSelection(view.state)).not.toBeNull();
        expect(document.activeElement).toBe(view.contentDOM);
        expect(canHandleTableSelectionKeydown(view)).toBe(true);
    });

    it("defers another cell's editor teardown until a rendered-cell drag is released", () => {
        const { view, cells } = mountGestureView();
        view.dispatch({
            effects: setActiveCellEffect.of({ tableFrom: 0, section: 'body', row: 0, col: 0 }),
        });
        mountNestedEditorHost(cells.body0);

        cells.header0.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }));
        elementAtPoint = cells.header1;
        document.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 20, clientY: 20 }));

        // The open editor stays put so the table cannot reflow under the pointer mid-drag.
        expect(getCellSelection(view.state)).not.toBeNull();
        expect(getActiveCell(view.state)).toMatchObject({ section: 'body', row: 0, col: 0 });
        expect(isCellDragInProgress(view.state)).toBe(true);

        document.dispatchEvent(pointerEvent('pointerup', { button: 0, clientX: 20, clientY: 20 }));

        expect(getActiveCell(view.state)).toBeNull();
        expect(isCellDragInProgress(view.state)).toBe(false);
        expect(getCellSelection(view.state)).not.toBeNull();
    });

    it('scrolls horizontally and advances the selection while the pointer stays at the edge', () => {
        const { view, widget, table, cells } = mountGestureView();
        const frames = mockAnimationFrames();
        setScrollDimensions(widget, { clientWidth: 100, scrollWidth: 300 });
        setScrollDimensions(view.scrollDOM, { clientHeight: 100, scrollHeight: 100 });
        vi.spyOn(widget, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 100, 100));
        vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 300, 100));
        vi.spyOn(view.scrollDOM, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 100, 100));

        cells.header0.dispatchEvent(
            pointerEvent('pointerdown', {
                button: 0,
                clientX: 10,
                clientY: 50,
            })
        );
        elementAtPoint = cells.header1;
        document.dispatchEvent(
            pointerEvent('pointermove', {
                button: 0,
                clientX: 95,
                clientY: 50,
            })
        );
        expect(frames.pendingCount()).toBe(1);

        elementAtPoint = cells.body1;
        frames.runNext(16);

        expect(widget.scrollLeft).toBeGreaterThan(0);
        expect(getCellSelection(view.state)?.focus).toEqual({
            section: 'body',
            row: 0,
            col: 1,
        });
        expect(frames.pendingCount()).toBe(1);

        document.dispatchEvent(
            pointerEvent('pointerup', {
                button: 0,
                clientX: 95,
                clientY: 50,
            })
        );
        expect(frames.cancelSpy).toHaveBeenCalledOnce();
        expect(frames.pendingCount()).toBe(0);
    });

    it('keeps auto-scrolling across a frame that reports no elapsed time', () => {
        const { view, widget, table, cells } = mountGestureView();
        const frames = mockAnimationFrames();
        setScrollDimensions(widget, { clientWidth: 100, scrollWidth: 300 });
        setScrollDimensions(view.scrollDOM, { clientHeight: 100, scrollHeight: 100 });
        vi.spyOn(widget, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 100, 100));
        vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 300, 100));
        vi.spyOn(view.scrollDOM, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 100, 100));

        cells.header0.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 50 }));
        elementAtPoint = cells.header1;
        document.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 95, clientY: 50 }));

        frames.runNext(16);
        const afterFirstFrame = widget.scrollLeft;
        expect(afterFirstFrame).toBeGreaterThan(0);

        // Two callbacks sharing a timestamp must not read as having hit the scroll boundary.
        frames.runNext(16);
        expect(widget.scrollLeft).toBeGreaterThan(afterFirstFrame);
        expect(frames.pendingCount()).toBe(1);

        document.dispatchEvent(pointerEvent('pointerup', { button: 0, clientX: 95, clientY: 50 }));
    });

    it('scrolls the editor vertically only while more of the table is hidden beyond the edge', () => {
        const { view, widget, table, cells } = mountGestureView();
        const frames = mockAnimationFrames();
        setScrollDimensions(widget, { clientWidth: 100, scrollWidth: 100 });
        setScrollDimensions(view.scrollDOM, { clientHeight: 100, scrollHeight: 300 });
        vi.spyOn(widget, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 100, 300));
        const tableRectSpy = vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 100, 300));
        vi.spyOn(view.scrollDOM, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 100, 100));

        cells.header0.dispatchEvent(
            pointerEvent('pointerdown', {
                button: 0,
                clientX: 50,
                clientY: 10,
            })
        );
        elementAtPoint = cells.body1;
        document.dispatchEvent(
            pointerEvent('pointermove', {
                button: 0,
                clientX: 50,
                clientY: 95,
            })
        );

        frames.runNext(16);
        expect(view.scrollDOM.scrollTop).toBeGreaterThan(0);
        expect(frames.pendingCount()).toBe(1);

        tableRectSpy.mockReturnValue(makeRect(0, -200, 100, 100));
        frames.runNext(32);
        expect(frames.pendingCount()).toBe(0);

        document.dispatchEvent(
            pointerEvent('pointerup', {
                button: 0,
                clientX: 50,
                clientY: 95,
            })
        );
    });

    it('scrolls the page when the editor does not scroll internally', () => {
        const { view, widget, table, cells } = mountGestureView();
        const frames = mockAnimationFrames();
        // The web app grows scrollDOM to the whole document and scrolls the page around it.
        vi.stubGlobal('innerHeight', 100);
        const page = makePageScroller({ clientHeight: 100, scrollHeight: 300 });
        setScrollDimensions(widget, { clientWidth: 100, scrollWidth: 100 });
        setScrollDimensions(view.scrollDOM, { clientHeight: 300, scrollHeight: 300 });
        vi.spyOn(widget, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 100, 300));
        vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 100, 300));
        vi.spyOn(view.scrollDOM, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 100, 300));

        cells.header0.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 50, clientY: 10 }));
        elementAtPoint = cells.body1;
        document.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 50, clientY: 95 }));

        frames.runNext(16);

        expect(page.scrollTop).toBeGreaterThan(0);
        expect(view.scrollDOM.scrollTop).toBe(0);

        document.dispatchEvent(pointerEvent('pointerup', { button: 0, clientX: 50, clientY: 95 }));
    });

    it('clamps the hit test to the window when the page is the scroller', () => {
        const { view, widget, table, cells } = mountGestureView();
        mockAnimationFrames();
        vi.stubGlobal('innerHeight', 100);
        makePageScroller({ clientHeight: 100, scrollHeight: 300 });
        setScrollDimensions(widget, { clientWidth: 100, scrollWidth: 100 });
        setScrollDimensions(view.scrollDOM, { clientHeight: 300, scrollHeight: 300 });
        vi.spyOn(widget, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 100, 300));
        vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 100, 300));
        vi.spyOn(view.scrollDOM, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 100, 300));
        // Only cells inside the window can be hit-tested; below it the browser returns nothing.
        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            value: vi.fn((_x: number, y: number) => {
                if (y <= 30) {
                    return cells.header1;
                }
                return y <= 100 ? cells.body1 : null;
            }),
        });

        cells.header0.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 50, clientY: 10 }));
        document.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 50, clientY: 20 }));
        expect(getCellSelection(view.state)?.focus).toEqual({ section: 'header', row: 0, col: 1 });

        // Below the window: the clamped hit test must land on the last row still on screen,
        // not on a point inside the off-screen part of scrollDOM.
        document.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 50, clientY: 250 }));

        expect(getCellSelection(view.state)?.focus).toEqual({ section: 'body', row: 0, col: 1 });
        document.dispatchEvent(pointerEvent('pointerup', { button: 0, clientX: 50, clientY: 250 }));
    });

    it('tracks the nearest cell when the pointer drags past a fully visible table', () => {
        const { view, widget, table, cells } = mountGestureView();
        mockAnimationFrames();
        setScrollDimensions(widget, { clientWidth: 100, scrollWidth: 100 });
        setScrollDimensions(view.scrollDOM, { clientHeight: 400, scrollHeight: 400 });
        vi.spyOn(widget, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 100, 100));
        vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 100, 100));
        vi.spyOn(view.scrollDOM, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 400, 400));
        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            value: vi.fn((_x: number, y: number) => {
                if (y <= 20) {
                    return cells.header1;
                }
                return y <= 100 ? cells.body1 : null;
            }),
        });

        cells.header0.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }));
        document.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 60, clientY: 10 }));
        expect(getCellSelection(view.state)?.focus).toEqual({ section: 'header', row: 0, col: 1 });

        // Below the table, where no edge zone triggers because the table is fully visible.
        document.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 90, clientY: 150 }));

        expect(getCellSelection(view.state)?.focus).toEqual({ section: 'body', row: 0, col: 1 });
    });

    it('extends the rectangle over a cell holding a raw HTML table', () => {
        const { view, cells } = mountGestureView();
        // Rendered Markdown may contain its own `td`, which carries no cell coordinates.
        const nestedTable = document.createElement('table');
        nestedTable.innerHTML = '<tr><td>nested</td></tr>';
        cells.body1.appendChild(nestedTable);

        cells.header0.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }));

        elementAtPoint = nestedTable.querySelector('td');
        document.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 20, clientY: 20 }));

        expect(getCellSelection(view.state)?.focus).toEqual({ section: 'body', row: 0, col: 1 });
    });

    it('opens the anchor editor when a rendered-cell drag contracts back to its anchor', () => {
        const { view, cells } = mountGestureView();
        const externalInput = document.createElement('input');
        document.body.appendChild(externalInput);
        externalInput.focus();
        cells.header0.dispatchEvent(
            pointerEvent('pointerdown', {
                button: 0,
                clientX: 10,
                clientY: 10,
            })
        );

        elementAtPoint = cells.header1;
        document.dispatchEvent(
            pointerEvent('pointermove', {
                button: 0,
                clientX: 20,
                clientY: 20,
            })
        );
        elementAtPoint = cells.header0;
        document.dispatchEvent(
            pointerEvent('pointermove', {
                button: 0,
                clientX: 10,
                clientY: 10,
            })
        );
        expect(getCellSelection(view.state)?.focus).toEqual({
            section: 'header',
            row: 0,
            col: 0,
        });

        const up = pointerEvent('pointerup', {
            button: 0,
            clientX: 10,
            clientY: 10,
        });
        document.dispatchEvent(up);

        expect(up.defaultPrevented).toBe(true);
        expect(getCellSelection(view.state)).toBeNull();
        expect(getActiveCell(view.state)).toMatchObject({
            section: 'header',
            row: 0,
            col: 0,
        });
        expect(getPendingOpenCellRequest(view.state)?.activeCell).toMatchObject({
            section: 'header',
            row: 0,
            col: 0,
        });
        expect(document.activeElement).toBe(externalInput);
    });

    it('leaves an active editor in native text-selection mode while the pointer stays in its cell', () => {
        const { view, cells } = mountGestureView();
        view.dispatch({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 0,
            }),
        });
        const nestedContent = mountNestedEditorHost(cells.body0);
        const down = pointerEvent('pointerdown', {
            button: 0,
            clientX: 10,
            clientY: 10,
        });
        nestedContent.dispatchEvent(down);
        const mouseDown = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0,
        });
        nestedContent.dispatchEvent(mouseDown);

        elementAtPoint = nestedContent;
        const moveWithinCell = pointerEvent('pointermove', {
            button: 0,
            clientX: 20,
            clientY: 20,
        });
        document.dispatchEvent(moveWithinCell);

        expect(down.defaultPrevented).toBe(false);
        expect(mouseDown.defaultPrevented).toBe(false);
        expect(moveWithinCell.defaultPrevented).toBe(false);
        expect(getCellSelection(view.state)).toBeNull();
        expect(getActiveCell(view.state)).toMatchObject({
            section: 'body',
            row: 0,
            col: 0,
        });

        elementAtPoint = null;
        const moveOutsideTable = pointerEvent('pointermove', {
            button: 0,
            clientX: 30,
            clientY: 30,
        });
        document.dispatchEvent(moveOutsideTable);
        expect(moveOutsideTable.defaultPrevented).toBe(false);

        const up = pointerEvent('pointerup', {
            button: 0,
            clientX: 30,
            clientY: 30,
        });
        document.dispatchEvent(up);

        expect(up.defaultPrevented).toBe(false);
        expect(getCellSelection(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('keeps the active editor mounted when a cell drag starts in row-height padding', () => {
        const { view, cells } = mountGestureView();
        const captureSpy = vi.fn();
        cells.body0.setPointerCapture = captureSpy;
        vi.spyOn(cells.body0, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 50, 100));
        view.dispatch({
            effects: setActiveCellEffect.of({ tableFrom: 0, section: 'body', row: 0, col: 0 }),
        });
        mountNestedEditorHost(cells.body0);

        // The cell itself represents empty row-height padding outside .rt-cell-editor.
        const down = pointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 90 });
        cells.body0.dispatchEvent(down);
        const mouseDown = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0,
        });
        cells.body0.dispatchEvent(mouseDown);

        expect(down.defaultPrevented).toBe(true);
        expect(mouseDown.defaultPrevented).toBe(true);
        expect(getActiveCell(view.state)).not.toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();

        elementAtPoint = cells.body1;
        const crossBoundary = pointerEvent('pointermove', { button: 0, clientX: 70, clientY: 90 });
        document.dispatchEvent(crossBoundary);

        expect(crossBoundary.defaultPrevented).toBe(true);
        expect(captureSpy).toHaveBeenCalledWith(1);
        expect(getActiveCell(view.state)).not.toBeNull();
        expect(getCellSelection(view.state)).toEqual({
            tableFrom: 0,
            anchor: { section: 'body', row: 0, col: 0 },
            focus: { section: 'body', row: 0, col: 1 },
        });

        document.dispatchEvent(pointerEvent('pointerup', { button: 0, clientX: 70, clientY: 90 }));

        expect(getActiveCell(view.state)).toBeNull();
        expect(getCellSelection(view.state)).not.toBeNull();
    });

    it('does not reopen the active editor when its row-height padding is clicked', () => {
        const { view, cells } = mountGestureView();
        view.dispatch({
            effects: setActiveCellEffect.of({ tableFrom: 0, section: 'body', row: 0, col: 0 }),
        });
        mountNestedEditorHost(cells.body0);

        cells.body0.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 90 }));
        const mouseDown = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0,
        });
        cells.body0.dispatchEvent(mouseDown);
        elementAtPoint = cells.body0;
        const up = pointerEvent('pointerup', { button: 0, clientX: 10, clientY: 90 });
        document.dispatchEvent(up);

        expect(mouseDown.defaultPrevented).toBe(true);
        expect(up.defaultPrevented).toBe(false);
        expect(getActiveCell(view.state)).toMatchObject({ section: 'body', row: 0, col: 0 });
        expect(getCellSelection(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('switches an active-editor text drag to cell selection after clearing the anchor border', () => {
        const { view, cells } = mountGestureView();
        const captureSpy = vi.fn();
        cells.body0.setPointerCapture = captureSpy;
        vi.spyOn(cells.body0, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 50, 20));
        view.dispatch({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 0,
            }),
        });
        const nestedContent = mountNestedEditorHost(cells.body0);
        nestedContent.dispatchEvent(
            pointerEvent('pointerdown', {
                button: 0,
                clientX: 10,
                clientY: 10,
            })
        );
        expect(captureSpy).not.toHaveBeenCalled();

        elementAtPoint = cells.body1;
        const crossBoundary = pointerEvent('pointermove', {
            button: 0,
            clientX: 70,
            clientY: 10,
        });
        document.dispatchEvent(crossBoundary);

        expect(crossBoundary.defaultPrevented).toBe(true);
        expect(captureSpy).toHaveBeenCalledWith(1);
        expect(getActiveCell(view.state)).toMatchObject({
            section: 'body',
            row: 0,
            col: 0,
        });
        expect(getCellSelection(view.state)).toEqual({
            tableFrom: 0,
            anchor: { section: 'body', row: 0, col: 0 },
            focus: { section: 'body', row: 0, col: 1 },
        });

        const up = pointerEvent('pointerup', {
            button: 0,
            clientX: 70,
            clientY: 10,
        });
        document.dispatchEvent(up);

        expect(up.defaultPrevented).toBe(true);
        expect(getCellSelection(view.state)).not.toBeNull();
        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('ends the nested text drag at conversion instead of silencing mouse moves', () => {
        const { view, cells } = mountGestureView();
        vi.spyOn(cells.body0, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 50, 20));
        view.dispatch({
            effects: setActiveCellEffect.of({ tableFrom: 0, section: 'body', row: 0, col: 0 }),
        });
        const nestedContent = mountNestedEditorHost(cells.body0);
        nestedContent.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }));

        // Stands in for CodeMirror's own drag handler, which ends its selection — and the
        // interval driving its edge scrolling — on the first move with no button held.
        const heldMoves: number[] = [];
        const releasedMoves: number[] = [];
        const documentMoves = vi.fn((event: MouseEvent) => {
            (event.buttons === 0 ? releasedMoves : heldMoves).push(event.buttons);
        });
        document.addEventListener('mousemove', documentMoves);

        try {
            elementAtPoint = cells.body1;
            document.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 70, clientY: 10 }));
            expect(getCellSelection(view.state)).not.toBeNull();
            expect(releasedMoves).toEqual([0]);

            // Unrelated listeners keep receiving moves for the rest of the drag.
            const duringDrag = new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1 });
            document.dispatchEvent(duringDrag);

            expect(duringDrag.defaultPrevented).toBe(false);
            expect(heldMoves).toEqual([1]);
            expect(releasedMoves).toEqual([0]);
        } finally {
            document.removeEventListener('mousemove', documentMoves);
        }
    });

    it('hit-tests pointerup before active-editor teardown can reflow the table', () => {
        const { view, cells } = mountGestureView();
        view.dispatch({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 0,
            }),
        });
        const nestedContent = mountNestedEditorHost(cells.body0);
        nestedContent.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }));

        // Model a Markdown-rendering reflow: while the editor is mounted this point is
        // body1, but after teardown the same point would land back on the anchor cell.
        vi.mocked(document.elementFromPoint).mockImplementation(() =>
            getActiveCell(view.state) ? cells.body1 : cells.body0
        );
        document.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 70, clientY: 10 }));

        expect(getActiveCell(view.state)).not.toBeNull();
        expect(getCellSelection(view.state)?.focus).toEqual({ section: 'body', row: 0, col: 1 });

        document.dispatchEvent(pointerEvent('pointerup', { button: 0, clientX: 70, clientY: 10 }));

        expect(getCellSelection(view.state)?.focus).toEqual({ section: 'body', row: 0, col: 1 });
        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('keeps an active-editor text drag that only grazes the neighbouring cell', () => {
        const { view, cells } = mountGestureView();
        const captureSpy = vi.fn();
        cells.body0.setPointerCapture = captureSpy;
        vi.spyOn(cells.body0, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 50, 20));
        view.dispatch({
            effects: setActiveCellEffect.of({ tableFrom: 0, section: 'body', row: 0, col: 0 }),
        });
        const nestedContent = mountNestedEditorHost(cells.body0);
        nestedContent.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 40, clientY: 10 }));

        // Three pixels past the border: an overshoot while selecting text, not a cell drag.
        elementAtPoint = cells.body1;
        const graze = pointerEvent('pointermove', { button: 0, clientX: 53, clientY: 10 });
        document.dispatchEvent(graze);

        expect(graze.defaultPrevented).toBe(false);
        expect(captureSpy).not.toHaveBeenCalled();
        expect(getCellSelection(view.state)).toBeNull();
        expect(getActiveCell(view.state)).not.toBeNull();

        // Travelling clearly past the border still converts.
        document.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 70, clientY: 10 }));

        expect(getCellSelection(view.state)?.focus).toEqual({ section: 'body', row: 0, col: 1 });
        expect(getActiveCell(view.state)).not.toBeNull();
    });

    it('keeps the active editor open when its cell-selection drag is released over the anchor', () => {
        const { view, cells } = mountGestureView();
        view.dispatch({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 0,
            }),
        });
        const nestedContent = mountNestedEditorHost(cells.body0);
        nestedContent.dispatchEvent(
            pointerEvent('pointerdown', {
                button: 0,
                clientX: 10,
                clientY: 10,
            })
        );

        elementAtPoint = cells.body1;
        document.dispatchEvent(
            pointerEvent('pointermove', {
                button: 0,
                clientX: 20,
                clientY: 20,
            })
        );
        elementAtPoint = cells.body0;
        document.dispatchEvent(
            pointerEvent('pointermove', {
                button: 0,
                clientX: 10,
                clientY: 10,
            })
        );
        expect(getCellSelection(view.state)?.focus).toEqual({
            section: 'body',
            row: 0,
            col: 0,
        });

        const up = pointerEvent('pointerup', {
            button: 0,
            clientX: 10,
            clientY: 10,
        });
        document.dispatchEvent(up);

        expect(up.defaultPrevented).toBe(true);
        expect(getCellSelection(view.state)).toBeNull();
        expect(getActiveCell(view.state)).toMatchObject({
            section: 'body',
            row: 0,
            col: 0,
        });
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('keeps the single-cell selection when an active-editor drag is released outside its anchor', () => {
        const { view, cells } = mountGestureView();
        view.dispatch({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 0,
            }),
        });
        const nestedContent = mountNestedEditorHost(cells.body0);
        nestedContent.dispatchEvent(
            pointerEvent('pointerdown', {
                button: 0,
                clientX: 10,
                clientY: 10,
            })
        );

        elementAtPoint = cells.body1;
        document.dispatchEvent(
            pointerEvent('pointermove', {
                button: 0,
                clientX: 20,
                clientY: 20,
            })
        );
        elementAtPoint = cells.body0;
        document.dispatchEvent(
            pointerEvent('pointermove', {
                button: 0,
                clientX: 10,
                clientY: 10,
            })
        );
        elementAtPoint = null;
        document.dispatchEvent(
            pointerEvent('pointerup', {
                button: 0,
                clientX: 30,
                clientY: 30,
            })
        );

        expect(getCellSelection(view.state)).not.toBeNull();
        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it.each([
        {
            label: 'pointer cancellation',
            finish: () => document.dispatchEvent(pointerEvent('pointercancel', { button: 0 })),
        },
        {
            label: 'a lost pointerup',
            finish: () =>
                document.dispatchEvent(
                    pointerEvent('pointermove', { button: 0, buttons: 0, clientX: 70, clientY: 10 })
                ),
        },
    ])('ends the active-editor overlap after $label', ({ finish }) => {
        const { view, cells } = mountGestureView();
        view.dispatch({
            effects: setActiveCellEffect.of({ tableFrom: 0, section: 'body', row: 0, col: 0 }),
        });
        const nestedContent = mountNestedEditorHost(cells.body0);
        nestedContent.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }));

        elementAtPoint = cells.body1;
        document.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 70, clientY: 10 }));
        expect(getActiveCell(view.state)).not.toBeNull();

        finish();

        expect(getCellSelection(view.state)).not.toBeNull();
        expect(getActiveCell(view.state)).toBeNull();
    });

    it('does not observe active-editor drags from touch pointers', () => {
        const { view, cells } = mountGestureView();
        view.dispatch({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 0,
            }),
        });
        const nestedContent = mountNestedEditorHost(cells.body0);
        const down = pointerEvent('pointerdown', {
            button: 0,
            pointerType: 'touch',
            clientX: 10,
            clientY: 10,
        });
        nestedContent.dispatchEvent(down);

        elementAtPoint = cells.body1;
        document.dispatchEvent(
            pointerEvent('pointermove', {
                button: 0,
                pointerType: 'touch',
                clientX: 20,
                clientY: 20,
            })
        );

        expect(down.defaultPrevented).toBe(false);
        expect(getCellSelection(view.state)).toBeNull();
        expect(getActiveCell(view.state)).not.toBeNull();
    });

    it('does not start drag selection for touch pointers', () => {
        const { view, cells } = mountGestureView();
        const down = pointerEvent('pointerdown', {
            button: 0,
            pointerType: 'touch',
            clientX: 10,
            clientY: 10,
        });
        cells.header0.dispatchEvent(down);

        elementAtPoint = cells.body1;
        document.dispatchEvent(
            pointerEvent('pointermove', {
                button: 0,
                pointerType: 'touch',
                clientX: 20,
                clientY: 20,
            })
        );
        document.dispatchEvent(
            pointerEvent('pointerup', {
                button: 0,
                pointerType: 'touch',
                clientX: 20,
                clientY: 20,
            })
        );

        expect(down.defaultPrevented).toBe(false);
        expect(getCellSelection(view.state)).toBeNull();
        expect(getActiveCell(view.state)).toBeNull();
    });

    it('keeps the last drag selection and stops tracking after pointer cancellation', () => {
        const { view, cells } = mountGestureView();
        const externalInput = document.createElement('input');
        document.body.appendChild(externalInput);
        externalInput.focus();
        cells.header0.dispatchEvent(
            pointerEvent('pointerdown', {
                button: 0,
                clientX: 10,
                clientY: 10,
            })
        );

        elementAtPoint = cells.body1;
        document.dispatchEvent(
            pointerEvent('pointermove', {
                button: 0,
                clientX: 20,
                clientY: 20,
            })
        );

        elementAtPoint = null;
        document.dispatchEvent(
            pointerEvent('pointermove', {
                button: 0,
                clientX: 25,
                clientY: 25,
            })
        );
        expect(getCellSelection(view.state)?.focus).toEqual({
            section: 'body',
            row: 0,
            col: 1,
        });

        document.dispatchEvent(pointerEvent('pointercancel', { button: 0 }));

        elementAtPoint = cells.header1;
        document.dispatchEvent(
            pointerEvent('pointermove', {
                button: 0,
                clientX: 30,
                clientY: 30,
            })
        );

        expect(getCellSelection(view.state)).toEqual({
            tableFrom: 0,
            anchor: { section: 'header', row: 0, col: 0 },
            focus: { section: 'body', row: 0, col: 1 },
        });
        expect(document.activeElement).toBe(externalInput);
    });

    it('focuses the main editor when a started drag detects a lost pointerup', () => {
        const { view, cells } = mountGestureView();
        const externalInput = document.createElement('input');
        document.body.appendChild(externalInput);
        externalInput.focus();

        cells.header0.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }));
        elementAtPoint = cells.body1;
        document.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 20, clientY: 20 }));
        expect(document.activeElement).toBe(externalInput);

        document.dispatchEvent(pointerEvent('pointermove', { button: 0, buttons: 0, clientX: 20, clientY: 20 }));

        expect(getCellSelection(view.state)).not.toBeNull();
        expect(document.activeElement).toBe(view.contentDOM);
    });

    it('stops tracking a gesture whose pointerup was lost, instead of following a bare hover', () => {
        const { view, cells } = mountGestureView();
        cells.header0.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }));

        // The release happened outside the window, so no pointerup ever arrived.
        elementAtPoint = cells.body1;
        document.dispatchEvent(pointerEvent('pointermove', { button: 0, buttons: 0, clientX: 40, clientY: 40 }));
        expect(getCellSelection(view.state)).toBeNull();

        document.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 50, clientY: 50 }));
        expect(getCellSelection(view.state)).toBeNull();
    });

    it('leaves a shift-click to the selection-extending mousedown path', () => {
        const { view, cells } = mountGestureView();
        view.dispatch({
            effects: setActiveCellEffect.of({ tableFrom: 0, section: 'header', row: 0, col: 0 }),
        });

        const down = pointerEvent('pointerdown', { button: 0, shiftKey: true, clientX: 10, clientY: 10 });
        cells.body1.dispatchEvent(down);
        expect(down.defaultPrevented).toBe(false);

        const compatibilityMouseDown = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            shiftKey: true,
        });
        cells.body1.dispatchEvent(compatibilityMouseDown);

        const extended = {
            tableFrom: 0,
            anchor: { section: 'header', row: 0, col: 0 },
            focus: { section: 'body', row: 0, col: 1 },
        };
        expect(getCellSelection(view.state)).toEqual(extended);

        // No gesture is tracking, so moving the pointer cannot redraw the rectangle.
        elementAtPoint = cells.body0;
        document.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 40, clientY: 40 }));
        expect(getCellSelection(view.state)).toEqual(extended);
    });

    it('stops tracking a gesture when the view is destroyed', () => {
        const { view, cells } = mountGestureView();
        cells.header0.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }));

        mountedViews.splice(mountedViews.indexOf(view), 1);
        view.destroy();

        elementAtPoint = cells.body1;
        const drag = pointerEvent('pointermove', { button: 0, clientX: 40, clientY: 40 });
        document.dispatchEvent(drag);
        document.dispatchEvent(pointerEvent('pointerup', { button: 0, clientX: 40, clientY: 40 }));

        expect(drag.defaultPrevented).toBe(false);
        expect(getCellSelection(view.state)).toBeNull();
    });

    it('replaces a stale gesture when a new pointerdown arrives', () => {
        const { view, cells } = mountGestureView();
        cells.header0.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }));

        // A second press with no intervening pointerup re-anchors rather than being ignored.
        cells.body0.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 40 }));

        elementAtPoint = cells.body1;
        document.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 40, clientY: 40 }));

        expect(getCellSelection(view.state)).toEqual({
            tableFrom: 0,
            anchor: { section: 'body', row: 0, col: 0 },
            focus: { section: 'body', row: 0, col: 1 },
        });
    });
});

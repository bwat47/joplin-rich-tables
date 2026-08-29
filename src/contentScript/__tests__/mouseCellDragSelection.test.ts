/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { activeCellField, getActiveCell, setActiveCellEffect } from '../tableState/activeCellState';
import { cellSelectionField, getCellSelection, setCellSelectionEffect } from '../tableState/cellSelectionState';
import { getPendingOpenCellRequest, openCellRequestField } from '../tableRuntime/openCellRequest';
import { handleTableInteraction } from '../tableWidget/tableWidgetInteractions';
import { mouseCellDragSelectionPlugin } from '../tableWidget/mouseCellDragSelection';
import { CLASS_TABLE_WIDGET } from '../tableWidget/domHelpers';
import { createMarkdownState } from './testMarkdownState';
import { resolvedActiveCellField } from '../tableRuntime/activeCell/resolvedActiveCell';
import { CLASS_CELL_EDITOR } from '../shared/tableDomClasses';

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

function createCell(section: 'header' | 'body', row: number, col: number): HTMLTableCellElement {
    const cell = document.createElement(section === 'header' ? 'th' : 'td');
    cell.dataset.section = section;
    cell.dataset.row = String(row);
    cell.dataset.col = String(col);
    return cell;
}

function mountGestureView(): MountedGestureView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const view = new EditorView({
        parent,
        state: createMarkdownState(GRID_DOC, [
            activeCellField,
            resolvedActiveCellField,
            cellSelectionField,
            openCellRequestField,
            mouseCellDragSelectionPlugin,
        ]),
    });
    mountedViews.push(view);

    vi.spyOn(view, 'posAtDOM').mockReturnValue(0);

    const widget = document.createElement('div');
    widget.className = CLASS_TABLE_WIDGET;
    const table = document.createElement('table');
    const cells = {
        header0: createCell('header', 0, 0),
        header1: createCell('header', 0, 1),
        body0: createCell('body', 0, 0),
        body1: createCell('body', 0, 1),
    };
    const headerRow = table.createTHead().insertRow();
    headerRow.append(cells.header0, cells.header1);
    const bodyRow = table.createTBody().insertRow();
    bodyRow.append(cells.body0, cells.body1);
    widget.appendChild(table);
    view.dom.appendChild(widget);
    view.dom.addEventListener('pointerdown', (event) => {
        handleTableInteraction(view, event);
    });
    view.dom.addEventListener('mousedown', (event) => {
        handleTableInteraction(view, event);
    });
    view.dom.addEventListener('click', (event) => {
        handleTableInteraction(view, event);
    });

    return { view, widget, table, cells };
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
    const host = document.createElement('div');
    host.className = CLASS_CELL_EDITOR;
    const content = document.createElement('div');
    content.setAttribute('contenteditable', 'true');
    host.appendChild(content);
    cell.appendChild(host);
    return content;
}

beforeEach(() => {
    originalElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
    Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: vi.fn(() => elementAtPoint),
    });
});

afterEach(() => {
    elementAtPoint = null;
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
    vi.restoreAllMocks();

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
        const afterFirstFrame = view.scrollDOM.scrollTop;
        expect(afterFirstFrame).toBeGreaterThan(0);
        expect(frames.pendingCount()).toBe(1);

        // Once the table's bottom is inside the viewport there is nothing left to reveal, so
        // the frame loop keeps running for hit-testing but stops scrolling.
        tableRectSpy.mockReturnValue(makeRect(0, -200, 100, 100));
        frames.runNext(32);
        expect(view.scrollDOM.scrollTop).toBe(afterFirstFrame);
        expect(frames.pendingCount()).toBe(1);

        document.dispatchEvent(
            pointerEvent('pointerup', {
                button: 0,
                clientX: 50,
                clientY: 95,
            })
        );
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

    it('re-resolves the focus when the table reflows under a stationary pointer', () => {
        const { view, cells } = mountGestureView();
        const frames = mockAnimationFrames();

        cells.header0.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }));
        elementAtPoint = cells.header1;
        document.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 40, clientY: 10 }));
        expect(getCellSelection(view.state)?.focus).toEqual({ section: 'header', row: 0, col: 1 });

        // Tearing down the nested editor re-renders the cells, so a different cell can land
        // under the unmoved pointer. No pointermove follows to report it.
        elementAtPoint = cells.body1;
        frames.runNext(16);

        expect(getCellSelection(view.state)?.focus).toEqual({ section: 'body', row: 0, col: 1 });
        expect(frames.pendingCount()).toBe(1);

        // A second, later reflow (the async markdown render landing) is picked up too.
        elementAtPoint = cells.body0;
        frames.runNext(32);

        expect(getCellSelection(view.state)?.focus).toEqual({ section: 'body', row: 0, col: 0 });
    });

    it('opens the anchor editor when a rendered-cell drag contracts back to its anchor', () => {
        const { view, cells } = mountGestureView();
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
        expect(getActiveCell(view.state)).toBeNull();
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
    });

    it('reopens the active editor when its cell-selection drag is released over the anchor', () => {
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
        expect(getPendingOpenCellRequest(view.state)?.activeCell).toMatchObject({
            section: 'body',
            row: 0,
            col: 0,
        });
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

/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { activeCellField, getActiveCell } from '../tableState/activeCellState';
import { cellSelectionField, getCellSelection, setCellSelectionEffect } from '../tableState/cellSelectionState';
import { getPendingOpenCellRequest, openCellRequestField } from '../tableRuntime/openCellRequest';
import { handleTableInteraction } from '../tableWidget/tableWidgetInteractions';
import { mouseCellDragSelectionPlugin } from '../tableWidget/mouseCellDragSelection';
import { CLASS_TABLE_WIDGET } from '../tableWidget/domHelpers';
import { createMarkdownState } from './testMarkdownState';

const GRID_DOC = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');

interface MountedGestureView {
    view: EditorView;
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

function pointerEvent(
    type: string,
    init: MouseEventInit & { pointerId?: number; pointerType?: string; isPrimary?: boolean }
): PointerEvent {
    const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
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

    return { view, cells };
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
});

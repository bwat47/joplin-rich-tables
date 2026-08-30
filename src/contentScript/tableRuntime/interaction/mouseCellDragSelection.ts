import { EditorView, ViewPlugin } from '@codemirror/view';
import { isSameCellCoords, type CellCoords } from '../../tableModel/types';
import { createResolvedActiveCell, type ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { requestOpenCell } from '../openCellRequest';
import { endCellDragSelection, setCellDragSelection } from '../selection/cellSelectionController';
import { resolveTableContextAtPos } from '../tableResolution';
import { clearCellSelectionEffect, getCellSelection } from '../../tableState/cellSelectionState';
import { flushNestedEditorState, refocusNestedEditor } from '../../nestedEditor/nestedEditorController';
import { clamp } from '../../shared/numberUtils';
import { MOUSE_BUTTON_LEFT } from '../../shared/mouseButtons';
import { SELECTOR_CELL, getWidgetSelector, readCellCoords } from '../../tableWidget/domHelpers';
import { CellDragAutoScroller } from './mouseCellDragAutoScroll';

const DRAG_START_DISTANCE_PX = 5;
const DRAG_START_DISTANCE_SQUARED = DRAG_START_DISTANCE_PX * DRAG_START_DISTANCE_PX;
const HIT_TEST_INSET_PX = 1;
// How far past the anchor cell's border a text-selection drag must travel before it
// becomes a cell selection, so grazing the border does not tear down the nested editor.
const BOUNDARY_EXIT_DISTANCE_PX = 8;
const BOUNDARY_EXIT_DISTANCE_SQUARED = BOUNDARY_EXIT_DISTANCE_PX * BOUNDARY_EXIT_DISTANCE_PX;

interface MouseCellGesture {
    origin: 'renderedCell' | 'activeEditor';
    consumeCompatibilityMouseDown: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    widget: HTMLElement;
    table: HTMLTableElement;
    anchorCell: HTMLElement;
    resolvedCell: ResolvedActiveCell;
    dragged: boolean;
    lastFocus: CellCoords | null;
    lastClientX: number;
    lastClientY: number;
}

/** Squared distance from the pointer to the nearest point of `rect`; zero while inside it. */
function distanceOutsideRectSquared(rect: DOMRect, event: PointerEvent): number {
    const deltaX = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
    const deltaY = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
    return deltaX * deltaX + deltaY * deltaY;
}

function distanceSquared(event: PointerEvent, gesture: MouseCellGesture): number {
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    return deltaX * deltaX + deltaY * deltaY;
}

class MouseCellDragSelectionController {
    private gesture: MouseCellGesture | null = null;
    private readonly autoScroller: CellDragAutoScroller;

    /**
     * CodeMirror's text-selection gesture is driven by compatibility mouse events.
     * Once an active-editor drag becomes a cell selection, suppress that event stream
     * so its native edge scrolling cannot compete with the table's auto-scroll loop.
     */
    private readonly onCompatibilityMouseMove = (event: MouseEvent): void => {
        const gesture = this.gesture;
        if (!gesture || gesture.origin !== 'activeEditor' || !gesture.dragged) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
    };

    private readonly onPointerMove = (event: PointerEvent): void => {
        const gesture = this.gesture;
        if (!gesture || event.pointerId !== gesture.pointerId) {
            return;
        }

        // The button is already up, so the pointerup was lost (released outside the window).
        // Without this a bare hover would keep driving the gesture.
        if (event.buttons === 0) {
            this.finishGesture();
            return;
        }

        gesture.lastClientX = event.clientX;
        gesture.lastClientY = event.clientY;

        const pointedCell = this.resolveCellAtPoint(event, gesture);
        if (!gesture.dragged) {
            if (gesture.origin === 'activeEditor') {
                // Until the pointer clears the anchor cell's border by a margin, the nested
                // editor retains full ownership so its native text-selection drag continues
                // uninterrupted.
                if (
                    !pointedCell ||
                    isSameCellCoords(gesture.resolvedCell.activeCell, pointedCell) ||
                    distanceOutsideRectSquared(gesture.anchorCell.getBoundingClientRect(), event) <
                        BOUNDARY_EXIT_DISTANCE_SQUARED
                ) {
                    return;
                }
                this.capturePointer(gesture);
                flushNestedEditorState(this.view);
            } else if (distanceSquared(event, gesture) < DRAG_START_DISTANCE_SQUARED) {
                return;
            }

            // A rectangle that cannot be dispatched — the table moved or was rewritten under
            // the gesture — leaves the press provisional rather than dropping it, so release
            // still opens the pressed cell instead of swallowing the click.
            gesture.dragged = this.applyFocus(gesture, pointedCell ?? gesture.resolvedCell.activeCell);
            if (!gesture.dragged) {
                return;
            }
        } else {
            // Once dragging, a pointer outside the table still tracks the nearest cell, so a
            // drag past the edge of a fully visible table keeps extending the rectangle.
            this.applyFocus(
                gesture,
                pointedCell ??
                    this.resolveVisibleCellAtPointer(gesture) ??
                    gesture.lastFocus ??
                    gesture.resolvedCell.activeCell
            );
        }

        this.scheduleAutoScroll(gesture);
        event.preventDefault();
        event.stopPropagation();
    };

    private readonly onPointerUp = (event: PointerEvent): void => {
        const gesture = this.gesture;
        if (!gesture || event.pointerId !== gesture.pointerId) {
            return;
        }

        const pointedCell = this.resolveCellAtPoint(event, gesture);
        const shouldReactivateAnchor =
            gesture.dragged && pointedCell !== null && isSameCellCoords(gesture.resolvedCell.activeCell, pointedCell);
        const shouldConsume = gesture.origin === 'renderedCell' || gesture.dragged;
        if (shouldConsume) {
            event.preventDefault();
            event.stopPropagation();
        }
        // Only an active-editor drag can hand its own still-open anchor back; a rendered-cell
        // drag reopens the anchor below, so whatever cell it left active is cleared first.
        this.finishGesture({ keepActiveCell: shouldReactivateAnchor && gesture.origin === 'activeEditor' });

        if (gesture.origin === 'renderedCell' && !gesture.dragged) {
            requestOpenCell(this.view, {
                resolvedCell: gesture.resolvedCell,
                clearCellSelection: Boolean(getCellSelection(this.view.state)),
            });
        } else if (shouldReactivateAnchor && gesture.origin === 'renderedCell') {
            const currentContext = resolveTableContextAtPos(this.view.state, gesture.resolvedCell.tableFrom);
            const resolvedAnchor = currentContext
                ? createResolvedActiveCell({
                      ctx: currentContext,
                      coords: gesture.resolvedCell.activeCell,
                  })
                : null;
            if (resolvedAnchor) {
                requestOpenCell(this.view, {
                    resolvedCell: resolvedAnchor,
                    clearCellSelection: true,
                });
            }
        } else if (shouldReactivateAnchor) {
            // The anchor editor never left the DOM, so contracting back to it only needs
            // to discard the provisional rectangle and restore keyboard focus.
            this.view.dispatch({ effects: clearCellSelectionEffect.of(undefined) });
            refocusNestedEditor(this.view);
        }
    };

    private readonly onPointerCancel = (event: PointerEvent): void => {
        if (this.gesture?.pointerId === event.pointerId) {
            this.finishGesture();
        }
    };

    constructor(private readonly view: EditorView) {
        this.autoScroller = new CellDragAutoScroller(view);
    }

    startRenderedCell(event: PointerEvent, cell: HTMLElement, resolvedCell: ResolvedActiveCell): boolean {
        if (event.pointerType !== 'mouse' || event.button !== MOUSE_BUTTON_LEFT || !event.isPrimary) {
            return false;
        }

        const widget = cell.closest(getWidgetSelector()) as HTMLElement | null;
        const table = cell.closest('table') as HTMLTableElement | null;
        if (!widget || !table || table.closest(getWidgetSelector()) !== widget) {
            return false;
        }

        event.preventDefault();
        event.stopPropagation();

        this.beginGesture({
            origin: 'renderedCell',
            consumeCompatibilityMouseDown: true,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            widget,
            table,
            anchorCell: cell,
            resolvedCell,
            dragged: false,
            lastFocus: null,
            lastClientX: event.clientX,
            lastClientY: event.clientY,
        });

        this.capturePointer(this.gesture);

        return true;
    }

    observeActiveCell(
        event: PointerEvent,
        cell: HTMLElement,
        resolvedCell: ResolvedActiveCell,
        options: { consumeInitialEvents: boolean }
    ): boolean {
        if (event.pointerType !== 'mouse' || event.button !== MOUSE_BUTTON_LEFT || !event.isPrimary) {
            return false;
        }

        const widget = cell.closest(getWidgetSelector()) as HTMLElement | null;
        const table = cell.closest('table') as HTMLTableElement | null;
        if (!widget || !table || table.closest(getWidgetSelector()) !== widget) {
            return false;
        }

        // Editable content retains native pointer and mouse handling. Cell padding has
        // no native text-selection behavior to preserve, so claim its initial events to
        // keep the outer editor from moving its caret or reopening the active cell.
        if (options.consumeInitialEvents) {
            event.preventDefault();
            event.stopPropagation();
        }

        this.beginGesture({
            origin: 'activeEditor',
            consumeCompatibilityMouseDown: options.consumeInitialEvents,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            widget,
            table,
            anchorCell: cell,
            resolvedCell,
            dragged: false,
            lastFocus: null,
            lastClientX: event.clientX,
            lastClientY: event.clientY,
        });
        return true;
    }

    consumeCompatibilityMouseDown(event: MouseEvent): boolean {
        if (!this.gesture?.consumeCompatibilityMouseDown || event.button !== MOUSE_BUTTON_LEFT) {
            return false;
        }

        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    destroy(): void {
        // Dispatching from a destroy hook is not safe; `cellDragField` clears itself instead.
        this.detachGesture();
    }

    private resolveCellAtPoint(event: PointerEvent, gesture: MouseCellGesture): CellCoords | null {
        return this.resolveCellAtClientPoint(event.clientX, event.clientY, gesture);
    }

    private resolveCellAtClientPoint(clientX: number, clientY: number, gesture: MouseCellGesture): CellCoords | null {
        const element = this.view.dom.ownerDocument.elementFromPoint(clientX, clientY);
        const cell = element?.closest(SELECTOR_CELL) as HTMLElement | null;
        if (!cell || cell.closest(getWidgetSelector()) !== gesture.widget) {
            return null;
        }

        return readCellCoords(cell);
    }

    private resolveVisibleCellAtPointer(gesture: MouseCellGesture): CellCoords | null {
        const tableRect = gesture.table.getBoundingClientRect();
        const widgetRect = gesture.widget.getBoundingClientRect();
        const scrollRect = this.view.scrollDOM.getBoundingClientRect();
        const left = Math.max(tableRect.left, widgetRect.left, scrollRect.left);
        const right = Math.min(tableRect.right, widgetRect.right, scrollRect.right);
        const top = Math.max(tableRect.top, widgetRect.top, scrollRect.top);
        const bottom = Math.min(tableRect.bottom, widgetRect.bottom, scrollRect.bottom);
        if (right <= left || bottom <= top) {
            return null;
        }

        const insetX = Math.min(HIT_TEST_INSET_PX, (right - left) / 2);
        const insetY = Math.min(HIT_TEST_INSET_PX, (bottom - top) / 2);
        return this.resolveCellAtClientPoint(
            clamp(gesture.lastClientX, left + insetX, right - insetX),
            clamp(gesture.lastClientY, top + insetY, bottom - insetY),
            gesture
        );
    }

    /** Extends the drag rectangle to `focus`, if it moved. Returns whether a selection now exists. */
    private applyFocus(gesture: MouseCellGesture, focus: CellCoords): boolean {
        if (isSameCellCoords(gesture.lastFocus, focus)) {
            return true;
        }

        if (!setCellDragSelection(this.view, gesture.resolvedCell.tableFrom, gesture.resolvedCell.activeCell, focus)) {
            return false;
        }

        gesture.lastFocus = focus;
        return true;
    }

    private scheduleAutoScroll(gesture: MouseCellGesture): void {
        if (!gesture.dragged) {
            return;
        }

        this.autoScroller.schedule({
            widget: gesture.widget,
            table: gesture.table,
            pointer: () => ({ x: gesture.lastClientX, y: gesture.lastClientY }),
            onScrolled: () => {
                const focus = this.resolveVisibleCellAtPointer(gesture);
                if (focus) {
                    this.applyFocus(gesture, focus);
                }
            },
        });
    }

    private beginGesture(gesture: MouseCellGesture): void {
        // A fresh pointerdown proves any earlier gesture is over, even if its pointerup was lost.
        this.finishGesture();
        this.gesture = gesture;
        const doc = this.view.dom.ownerDocument;
        doc.addEventListener('mousemove', this.onCompatibilityMouseMove, true);
        doc.addEventListener('pointermove', this.onPointerMove, true);
        doc.addEventListener('pointerup', this.onPointerUp, true);
        doc.addEventListener('pointercancel', this.onPointerCancel, true);
    }

    private capturePointer(gesture: MouseCellGesture | null): void {
        if (!gesture) {
            return;
        }

        try {
            gesture.anchorCell.setPointerCapture?.(gesture.pointerId);
        } catch {
            // Pointer capture is an enhancement. Document listeners still finish the gesture.
        }
    }

    /** Releases the gesture's listeners, capture, and scroll loop without touching editor state. */
    private detachGesture(): MouseCellGesture | null {
        const gesture = this.gesture;
        if (!gesture) {
            return null;
        }

        this.gesture = null;
        const doc = this.view.dom.ownerDocument;
        doc.removeEventListener('mousemove', this.onCompatibilityMouseMove, true);
        doc.removeEventListener('pointermove', this.onPointerMove, true);
        doc.removeEventListener('pointerup', this.onPointerUp, true);
        doc.removeEventListener('pointercancel', this.onPointerCancel, true);

        this.autoScroller.cancel();

        try {
            gesture.anchorCell.releasePointerCapture?.(gesture.pointerId);
        } catch {
            // The browser may already have released capture on pointerup/cancel.
        }

        return gesture;
    }

    private finishGesture(options: { keepActiveCell?: boolean } = {}): void {
        const gesture = this.detachGesture();
        if (!gesture?.dragged) {
            return;
        }

        // The rectangle is final and pointer hit-testing is over, so the deferred teardown of
        // the cell that stayed open through the drag can run without moving the table.
        endCellDragSelection(this.view, { keepActiveCell: Boolean(options.keepActiveCell) });
    }
}

export const mouseCellDragSelectionPlugin = ViewPlugin.fromClass(MouseCellDragSelectionController);

export function beginMouseCellGesture(
    view: EditorView,
    event: PointerEvent,
    cell: HTMLElement,
    resolvedCell: ResolvedActiveCell
): boolean {
    return view.plugin?.(mouseCellDragSelectionPlugin)?.startRenderedCell(event, cell, resolvedCell) ?? false;
}

export function observeActiveCellMouseGesture(
    view: EditorView,
    event: PointerEvent,
    cell: HTMLElement,
    resolvedCell: ResolvedActiveCell,
    options: { consumeInitialEvents: boolean }
): boolean {
    return view.plugin?.(mouseCellDragSelectionPlugin)?.observeActiveCell(event, cell, resolvedCell, options) ?? false;
}

export function consumeMouseCellGestureMouseDown(view: EditorView, event: MouseEvent): boolean {
    return view.plugin?.(mouseCellDragSelectionPlugin)?.consumeCompatibilityMouseDown(event) ?? false;
}

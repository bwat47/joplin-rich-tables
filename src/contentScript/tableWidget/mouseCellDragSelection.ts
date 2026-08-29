import { EditorView, ViewPlugin } from '@codemirror/view';
import { isSameCellCoords, type CellCoords } from '../tableModel/types';
import { createResolvedActiveCell, type ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { requestOpenCell } from '../tableRuntime/openCellRequest';
import { setCellSelectionFromCoords } from '../tableRuntime/selection/cellSelectionController';
import { resolveTableContextAtPos } from '../tableRuntime/tableResolution';
import { getCellSelection } from '../tableState/cellSelectionState';
import { flushNestedEditorState } from '../nestedEditor/nestedEditorController';
import { getViewWindow, requestViewAnimationFrame } from '../shared/domContext';
import { clamp } from '../shared/numberUtils';
import { MOUSE_BUTTON_LEFT } from '../shared/mouseButtons';
import { SELECTOR_CELL, getWidgetSelector, readCellCoords } from './domHelpers';
import { calculateEdgeScrollIntensity } from './mouseCellDragAutoScroll';

const DRAG_START_DISTANCE_PX = 5;
const DRAG_START_DISTANCE_SQUARED = DRAG_START_DISTANCE_PX * DRAG_START_DISTANCE_PX;
const EDGE_SCROLL_ZONE_PX = 48;
const EDGE_SCROLL_MAX_SPEED_PX_PER_SECOND = 900;
const EDGE_SCROLL_DEFAULT_FRAME_MS = 1000 / 60;
const EDGE_SCROLL_MAX_FRAME_MS = 50;
// A zero-length frame would produce a zero delta, which the loop cannot tell apart
// from having reached a scroll boundary.
const EDGE_SCROLL_MIN_FRAME_MS = 1;
const HIT_TEST_INSET_PX = 1;
// How far past the anchor cell's border a text-selection drag must travel before it
// becomes a cell selection, so grazing the border does not tear down the nested editor.
const BOUNDARY_EXIT_DISTANCE_PX = 8;
const BOUNDARY_EXIT_DISTANCE_SQUARED = BOUNDARY_EXIT_DISTANCE_PX * BOUNDARY_EXIT_DISTANCE_PX;

interface MouseCellGesture {
    origin: 'renderedCell' | 'activeEditor';
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
    dragFrameId: number | null;
    lastFrameTimestamp: number | null;
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

function applyScrollDelta(element: HTMLElement, axis: 'horizontal' | 'vertical', delta: number): void {
    const current = axis === 'horizontal' ? element.scrollLeft : element.scrollTop;
    const scrollSize = axis === 'horizontal' ? element.scrollWidth : element.scrollHeight;
    const clientSize = axis === 'horizontal' ? element.clientWidth : element.clientHeight;
    const next = clamp(current + delta, 0, Math.max(0, scrollSize - clientSize));
    if (next === current) {
        return;
    }

    if (axis === 'horizontal') {
        element.scrollLeft = next;
    } else {
        element.scrollTop = next;
    }
}

class MouseCellDragSelectionController {
    private gesture: MouseCellGesture | null = null;

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

            const focus = pointedCell ?? gesture.resolvedCell.activeCell;
            gesture.dragged = setCellSelectionFromCoords(
                this.view,
                gesture.resolvedCell.tableFrom,
                gesture.resolvedCell.activeCell,
                focus,
                { scrollFocusIntoView: false }
            );
            if (!gesture.dragged) {
                this.finishGesture();
                return;
            }
            gesture.lastFocus = focus;
        } else {
            this.applyDragFocus(gesture, this.resolveDragFocus(gesture));
        }

        this.scheduleDragFrame(gesture);
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
        this.finishGesture();

        if (gesture.origin === 'renderedCell' && !gesture.dragged) {
            requestOpenCell(this.view, {
                resolvedCell: gesture.resolvedCell,
                clearCellSelection: Boolean(getCellSelection(this.view.state)),
            });
        } else if (shouldReactivateAnchor) {
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
        }
    };

    private readonly onPointerCancel = (event: PointerEvent): void => {
        if (this.gesture?.pointerId === event.pointerId) {
            this.finishGesture();
        }
    };

    constructor(private readonly view: EditorView) {}

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
            dragFrameId: null,
            lastFrameTimestamp: null,
        });

        this.capturePointer(this.gesture);

        return true;
    }

    observeActiveEditor(event: PointerEvent, cell: HTMLElement, resolvedCell: ResolvedActiveCell): boolean {
        if (event.pointerType !== 'mouse' || event.button !== MOUSE_BUTTON_LEFT || !event.isPrimary) {
            return false;
        }

        const widget = cell.closest(getWidgetSelector()) as HTMLElement | null;
        const table = cell.closest('table') as HTMLTableElement | null;
        if (!widget || !table || table.closest(getWidgetSelector()) !== widget) {
            return false;
        }

        // This mode is deliberately passive: no preventDefault, propagation stop, or
        // pointer capture until movement crosses into a different table cell.
        this.beginGesture({
            origin: 'activeEditor',
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
            dragFrameId: null,
            lastFrameTimestamp: null,
        });
        return true;
    }

    consumeCompatibilityMouseDown(event: MouseEvent): boolean {
        if (this.gesture?.origin !== 'renderedCell' || event.button !== MOUSE_BUTTON_LEFT) {
            return false;
        }

        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    destroy(): void {
        this.finishGesture();
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

    /**
     * The cell under a stationary pointer changes whenever the table reflows, which this
     * gesture causes itself: tearing down the nested editor swaps raw markdown for rendered
     * HTML, and an uncached cell renders again asynchronously after that. So the focus is
     * re-resolved every frame for the life of the drag rather than only on pointer movement.
     */
    private scheduleDragFrame(gesture: MouseCellGesture): void {
        if (!gesture.dragged || gesture.dragFrameId !== null) {
            return;
        }

        gesture.dragFrameId = requestViewAnimationFrame(this.view, (timestamp) => {
            this.runDragFrame(gesture, timestamp);
        });
    }

    private runDragFrame(gesture: MouseCellGesture, timestamp: number): void {
        if (this.gesture !== gesture || !gesture.dragged) {
            return;
        }
        gesture.dragFrameId = null;

        const widgetRect = gesture.widget.getBoundingClientRect();
        const tableRect = gesture.table.getBoundingClientRect();
        const scrollRect = this.view.scrollDOM.getBoundingClientRect();
        const horizontalIntensity = calculateEdgeScrollIntensity(
            gesture.lastClientX,
            widgetRect.left,
            widgetRect.right,
            EDGE_SCROLL_ZONE_PX
        );
        let verticalIntensity = calculateEdgeScrollIntensity(
            gesture.lastClientY,
            scrollRect.top,
            scrollRect.bottom,
            EDGE_SCROLL_ZONE_PX
        );
        if (
            (verticalIntensity < 0 && tableRect.top >= scrollRect.top) ||
            (verticalIntensity > 0 && tableRect.bottom <= scrollRect.bottom)
        ) {
            verticalIntensity = 0;
        }

        const elapsedMs =
            gesture.lastFrameTimestamp === null
                ? EDGE_SCROLL_DEFAULT_FRAME_MS
                : clamp(timestamp - gesture.lastFrameTimestamp, EDGE_SCROLL_MIN_FRAME_MS, EDGE_SCROLL_MAX_FRAME_MS);
        gesture.lastFrameTimestamp = timestamp;
        const maxDelta = (EDGE_SCROLL_MAX_SPEED_PX_PER_SECOND * elapsedMs) / 1000;
        // The widget is the table's horizontal scroller; the editor's scrollDOM is the vertical
        // one. If either ever stops being scrollable, that axis simply reports no movement.
        applyScrollDelta(gesture.widget, 'horizontal', horizontalIntensity * maxDelta);
        applyScrollDelta(this.view.scrollDOM, 'vertical', verticalIntensity * maxDelta);

        this.applyDragFocus(gesture, this.resolveDragFocus(gesture));
        this.scheduleDragFrame(gesture);
    }

    /**
     * The cell under the pointer, falling back to the nearest visible one so a drag past the
     * edge of a fully visible table keeps extending the rectangle.
     */
    private resolveDragFocus(gesture: MouseCellGesture): CellCoords {
        return (
            this.resolveCellAtClientPoint(gesture.lastClientX, gesture.lastClientY, gesture) ??
            this.resolveVisibleCellAtPointer(gesture) ??
            gesture.lastFocus ??
            gesture.resolvedCell.activeCell
        );
    }

    private applyDragFocus(gesture: MouseCellGesture, focus: CellCoords): void {
        if (isSameCellCoords(gesture.lastFocus, focus)) {
            return;
        }

        if (
            setCellSelectionFromCoords(
                this.view,
                gesture.resolvedCell.tableFrom,
                gesture.resolvedCell.activeCell,
                focus,
                { scrollFocusIntoView: false }
            )
        ) {
            gesture.lastFocus = focus;
        }
    }

    private beginGesture(gesture: MouseCellGesture): void {
        // A fresh pointerdown proves any earlier gesture is over, even if its pointerup was lost.
        this.finishGesture();
        this.gesture = gesture;
        const doc = this.view.dom.ownerDocument;
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

    private finishGesture(): void {
        const gesture = this.gesture;
        if (!gesture) {
            return;
        }

        this.gesture = null;
        const doc = this.view.dom.ownerDocument;
        doc.removeEventListener('pointermove', this.onPointerMove, true);
        doc.removeEventListener('pointerup', this.onPointerUp, true);
        doc.removeEventListener('pointercancel', this.onPointerCancel, true);

        if (gesture.dragFrameId !== null) {
            getViewWindow(this.view).cancelAnimationFrame(gesture.dragFrameId);
            gesture.dragFrameId = null;
        }

        try {
            gesture.anchorCell.releasePointerCapture?.(gesture.pointerId);
        } catch {
            // The browser may already have released capture on pointerup/cancel.
        }
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

export function observeActiveEditorMouseGesture(
    view: EditorView,
    event: PointerEvent,
    cell: HTMLElement,
    resolvedCell: ResolvedActiveCell
): boolean {
    return view.plugin?.(mouseCellDragSelectionPlugin)?.observeActiveEditor(event, cell, resolvedCell) ?? false;
}

export function consumeMouseCellGestureMouseDown(view: EditorView, event: MouseEvent): boolean {
    return view.plugin?.(mouseCellDragSelectionPlugin)?.consumeCompatibilityMouseDown(event) ?? false;
}

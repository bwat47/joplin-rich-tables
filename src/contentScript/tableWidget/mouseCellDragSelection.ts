import { EditorView, ViewPlugin } from '@codemirror/view';
import type { CellCoords } from '../tableModel/types';
import { createResolvedActiveCell, type ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { requestOpenCell } from '../tableRuntime/openCellRequest';
import { setCellSelectionFromCoords } from '../tableRuntime/selection/cellSelectionController';
import { resolveTableContextAtPos } from '../tableRuntime/tableResolution';
import { getCellSelection } from '../tableState/cellSelectionState';
import { flushNestedEditorState } from '../nestedEditor/nestedEditorController';
import { getWidgetSelector, readCellCoords } from './domHelpers';

const SELECTOR_CELL = 'td, th';
const MOUSE_BUTTON_LEFT = 0;
const DRAG_START_DISTANCE_PX = 5;
const DRAG_START_DISTANCE_SQUARED = DRAG_START_DISTANCE_PX * DRAG_START_DISTANCE_PX;

interface MouseCellGesture {
    origin: 'renderedCell' | 'activeEditor';
    pointerId: number;
    startX: number;
    startY: number;
    widget: HTMLElement;
    captureTarget: HTMLElement | null;
    resolvedCell: ResolvedActiveCell;
    dragged: boolean;
    lastFocus: CellCoords | null;
}

function sameCoords(left: CellCoords | null, right: CellCoords): boolean {
    return left?.section === right.section && left.row === right.row && left.col === right.col;
}

function distanceSquared(event: PointerEvent, gesture: MouseCellGesture): number {
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    return deltaX * deltaX + deltaY * deltaY;
}

class MouseCellDragSelectionController {
    private gesture: MouseCellGesture | null = null;

    private readonly onPointerMove = (event: PointerEvent): void => {
        const gesture = this.gesture;
        if (!gesture || event.pointerId !== gesture.pointerId) {
            return;
        }

        const pointedCell = this.resolveCellAtPoint(event, gesture);
        if (!gesture.dragged) {
            if (gesture.origin === 'activeEditor') {
                // Until the pointer enters another cell, the nested editor retains full
                // ownership so its native text-selection drag continues uninterrupted.
                if (!pointedCell || sameCoords(gesture.resolvedCell.activeCell, pointedCell)) {
                    return;
                }
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
            const focus = pointedCell ?? gesture.lastFocus ?? gesture.resolvedCell.activeCell;
            if (
                !sameCoords(gesture.lastFocus, focus) &&
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
            gesture.dragged && pointedCell !== null && sameCoords(gesture.resolvedCell.activeCell, pointedCell);
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
                    scrollIntoView: false,
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
        if (event.pointerType !== 'mouse' || event.button !== MOUSE_BUTTON_LEFT || !event.isPrimary || this.gesture) {
            return false;
        }

        const widget = cell.closest(getWidgetSelector()) as HTMLElement | null;
        if (!widget) {
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
            captureTarget: cell,
            resolvedCell,
            dragged: false,
            lastFocus: null,
        });

        try {
            cell.setPointerCapture?.(event.pointerId);
        } catch {
            // Pointer capture is an enhancement. Document listeners still finish the gesture.
        }

        return true;
    }

    observeActiveEditor(event: PointerEvent, cell: HTMLElement, resolvedCell: ResolvedActiveCell): boolean {
        if (event.pointerType !== 'mouse' || event.button !== MOUSE_BUTTON_LEFT || !event.isPrimary || this.gesture) {
            return false;
        }

        const widget = cell.closest(getWidgetSelector()) as HTMLElement | null;
        if (!widget) {
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
            captureTarget: null,
            resolvedCell,
            dragged: false,
            lastFocus: null,
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
        const element = this.view.dom.ownerDocument.elementFromPoint(event.clientX, event.clientY);
        const cell = element?.closest(SELECTOR_CELL) as HTMLElement | null;
        if (!cell || cell.closest(getWidgetSelector()) !== gesture.widget) {
            return null;
        }

        return readCellCoords(cell);
    }

    private beginGesture(gesture: MouseCellGesture): void {
        this.gesture = gesture;
        const doc = this.view.dom.ownerDocument;
        doc.addEventListener('pointermove', this.onPointerMove, true);
        doc.addEventListener('pointerup', this.onPointerUp, true);
        doc.addEventListener('pointercancel', this.onPointerCancel, true);
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

        try {
            gesture.captureTarget?.releasePointerCapture?.(gesture.pointerId);
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

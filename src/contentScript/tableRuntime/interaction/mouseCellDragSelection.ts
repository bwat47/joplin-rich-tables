import { EditorView, ViewPlugin } from '@codemirror/view';
import { isSameCellCoords, type CellCoords } from '../../tableModel/types';
import { createResolvedActiveCell, type ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { requestOpenCell } from '../openCellRequest';
import { endCellDragSelection, setCellDragSelection } from '../selection/cellSelectionController';
import { resolveTableContextAtPos } from '../tableResolution';
import { clearCellSelectionEffect, getCellSelection } from '../../tableState/cellSelectionState';
import { flushNestedEditorState, refocusNestedEditor } from '../../nestedEditor/nestedEditorController';
import { getViewWindow } from '../../shared/domContext';
import { getViewportHeight, resolveViewportBounds } from '../../shared/editorViewport';
import { clamp } from '../../shared/numberUtils';
import { isPrimaryMouseButton, isPrimaryMousePointer } from '../../shared/mouseEvents';
import { SELECTOR_CELL, getWidgetSelector, readCellCoords } from '../../tableWidget/domHelpers';
import {
    readRenderedCaretHit,
    setRenderedTextSelection,
    type RenderedCaretDomHit,
    type RenderedSelectionHit,
} from '../../tableWidget/cellCaretHit';
import { resolveClickCursorPos, resolveRenderedSelection } from './clickCursorPlacement';
import type { InitialCursorPos } from '../../shared/cursorPlacement';
import { CellDragAutoScroller } from './mouseCellDragAutoScroll';

const DRAG_START_DISTANCE_PX = 5;
const DRAG_START_DISTANCE_SQUARED = DRAG_START_DISTANCE_PX * DRAG_START_DISTANCE_PX;
const HIT_TEST_INSET_PX = 1;
// How far past the anchor cell's border a text-selection drag must travel before it
// becomes a cell selection, so grazing the border does not tear down the nested editor.
const BOUNDARY_EXIT_DISTANCE_PX = 8;
const BOUNDARY_EXIT_DISTANCE_SQUARED = BOUNDARY_EXIT_DISTANCE_PX * BOUNDARY_EXIT_DISTANCE_PX;

/**
 * Where the press landed, which also decides what the gesture does with the event.
 *
 * The active cell is two origins rather than one because its editor and its row-height padding
 * want opposite things from the same press.
 */
export type MouseCellGestureOrigin = 'renderedCell' | 'activeEditorPadding' | 'activeEditorText';

/**
 * Whether a press on each origin is taken from the editor, along with the compatibility
 * mousedown behind it.
 */
const ORIGIN_CONSUMES_PRESS: Record<MouseCellGestureOrigin, boolean> = {
    // Drive the rendered text range ourselves. A native drag would keep auto-scrolling
    // the editor even after promotion to a cell rectangle.
    renderedCell: true,
    // Padding has no native text-selection behaviour worth preserving.
    activeEditorPadding: true,
    // The nested editor owns its own press; the gesture only watches for the pointer leaving.
    activeEditorText: false,
};

/** True for the origins whose press belongs to the nested editor rather than to a rendered cell. */
function ownsNestedEditor(origin: MouseCellGestureOrigin): boolean {
    return origin !== 'renderedCell';
}

interface MouseCellGesture {
    origin: MouseCellGestureOrigin;
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
    /**
     * Caret the press pointed at, read while the rendered content was still mounted.
     * Only a press on a rendered cell carries one: an active-editor press already has a
     * nested editor to place its own caret, and a drag discards it.
     */
    pressCaretHit: RenderedCaretDomHit | null;
    /** Caret the last painted range ran to, which with `pressCaretHit` is that range. */
    lastHeadHit: RenderedCaretDomHit | null;
}

/**
 * What a pointer release resolved to, read before the release dispatches anything.
 *
 * Both the anchor and the caret placement depend on the document and the widget DOM as the
 * press left them, and settling the release changes both.
 */
interface GestureRelease {
    /** The pressed anchor against the current document, or null when it no longer resolves. */
    resolvedAnchor: ResolvedActiveCell | null;
    /** Caret the press pointed at, for a click that reopens the anchor. */
    cursorPos: InitialCursorPos | undefined;
    /** The drag ended back on the cell it started from, so that cell takes the caret again. */
    reactivateAnchor: boolean;
}

/**
 * The range the press drew across its anchor cell, or null when it drew none.
 *
 * The gesture is the only writer of the DOM selection inside a rendered cell: the press is taken
 * from the browser, so there is no native drag or double-click word selection to add one. Both
 * endpoints are therefore the hits it painted from, and reading the range back out of the DOM
 * would only re-derive them.
 *
 * The two must be measured against the same rendered text. A re-render between press and release
 * leaves their offsets incomparable, and the caret the press read is the better answer then.
 */
function renderedSelectionFromGesture(gesture: MouseCellGesture): RenderedSelectionHit | null {
    const anchor = gesture.pressCaretHit;
    const head = gesture.lastHeadHit;
    if (!anchor || !head || head.renderedText !== anchor.renderedText) {
        return null;
    }

    return head.renderedOffset === anchor.renderedOffset
        ? null
        : { renderedText: anchor.renderedText, anchor: anchor.renderedOffset, head: head.renderedOffset };
}

/** Squared distance between two points. */
function distanceSquared(x: number, y: number, fromX: number, fromY: number): number {
    const deltaX = x - fromX;
    const deltaY = y - fromY;
    return deltaX * deltaX + deltaY * deltaY;
}

/** Squared distance from a point to the nearest point of `rect`; zero while inside it. */
function distanceOutsideRectSquared(x: number, y: number, rect: DOMRect): number {
    const deltaX = Math.max(rect.left - x, 0, x - rect.right);
    const deltaY = Math.max(rect.top - y, 0, y - rect.bottom);
    return deltaX * deltaX + deltaY * deltaY;
}

class MouseCellDragSelectionController {
    private gesture: MouseCellGesture | null = null;
    private readonly autoScroller: CellDragAutoScroller;

    private readonly onPointerMove = (event: PointerEvent): void => {
        const gesture = this.gesture;
        if (!gesture || event.pointerId !== gesture.pointerId) {
            return;
        }

        // The button is already up, so the pointerup was lost (released outside the window).
        // Without this a bare hover would keep driving the gesture.
        if (event.buttons === 0) {
            this.finishGesture({ focusSelection: true });
            return;
        }

        gesture.lastClientX = event.clientX;
        gesture.lastClientY = event.clientY;

        const pointedCell = this.resolveCellAtPoint(event, gesture);
        if (!gesture.dragged) {
            const promoteTo = this.promotionTarget(gesture, event, pointedCell);
            if (!promoteTo) {
                // The press keeps whatever it is still doing in its own cell: drawing a rendered
                // text range, or leaving the nested editor's native drag alone.
                if (!ownsNestedEditor(gesture.origin)) {
                    this.updateRenderedTextSelection(gesture);
                }
                return;
            }

            if (ownsNestedEditor(gesture.origin)) {
                this.capturePointer(gesture);
                flushNestedEditorState(this.view);
                this.endNativeTextDrag(event);
            }

            // A rectangle that cannot be dispatched — the table moved or was rewritten under
            // the gesture — leaves the press provisional. Release re-resolves the pressed
            // widget and opens it only if it still identifies a current table.
            gesture.dragged = this.applyFocus(gesture, promoteTo);
            if (!gesture.dragged) {
                return;
            }
            if (gesture.origin === 'renderedCell') {
                // The rendered range belongs to this gesture; stop painting it on promotion.
                this.capturePointer(gesture);
                this.view.dom.ownerDocument.getSelection()?.removeAllRanges();
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

        const release = this.resolveRelease(event, gesture);
        const willReactivateAnchor =
            release.reactivateAnchor && (ownsNestedEditor(gesture.origin) || release.resolvedAnchor !== null);

        if (gesture.origin === 'renderedCell' || gesture.dragged) {
            event.preventDefault();
            event.stopPropagation();
        }

        // Only an active-editor drag can hand its own still-open anchor back; a rendered-cell
        // drag reopens the anchor below, so whatever cell it left active is cleared first.
        this.finishGesture({
            keepActiveCell: release.reactivateAnchor && ownsNestedEditor(gesture.origin),
            focusSelection: !willReactivateAnchor,
        });

        this.settleRelease(gesture, release);
    };

    /**
     * Reads everything about the release that depends on the view as the press left it.
     *
     * Resolved before `finishGesture` dispatches, so the caret placement is aligned against
     * the cell text that was actually pressed.
     */
    private resolveRelease(event: PointerEvent, gesture: MouseCellGesture): GestureRelease {
        const pointedCell = this.resolveCellAtPoint(event, gesture);
        const resolvedAnchor = gesture.origin === 'renderedCell' ? this.resolveCurrentRenderedAnchor(gesture) : null;

        let cursorPos: InitialCursorPos | undefined;
        if (!gesture.dragged && resolvedAnchor) {
            const selectionHit = renderedSelectionFromGesture(gesture);
            cursorPos = selectionHit
                ? resolveRenderedSelection(this.view.state, resolvedAnchor, selectionHit)
                : resolveClickCursorPos(this.view.state, resolvedAnchor, gesture.pressCaretHit);
        }

        return {
            resolvedAnchor,
            cursorPos,
            reactivateAnchor:
                gesture.dragged &&
                pointedCell !== null &&
                isSameCellCoords(gesture.resolvedCell.activeCell, pointedCell),
        };
    }

    /** Hands the released gesture to whichever cell should own the caret now. */
    private settleRelease(gesture: MouseCellGesture, release: GestureRelease): void {
        if (gesture.origin !== 'renderedCell') {
            if (release.reactivateAnchor) {
                // The anchor editor never left the DOM, so contracting back to it only needs
                // to discard the provisional rectangle and restore keyboard focus.
                this.view.dispatch({ effects: clearCellSelectionEffect.of(undefined) });
                refocusNestedEditor(this.view);
            }
            return;
        }

        // An anchor that no longer resolves cannot be reopened, and a drag that ended
        // anywhere but its anchor leaves its own selection standing.
        if (!release.resolvedAnchor || (gesture.dragged && !release.reactivateAnchor)) {
            return;
        }

        requestOpenCell(this.view, {
            resolvedCell: release.resolvedAnchor,
            clearCellSelection: gesture.dragged || Boolean(getCellSelection(this.view.state)),
            // A drag that contracted back onto its anchor asked for a cell selection, not for
            // a caret at the point the press happened to start from.
            initialCursorPos: gesture.dragged ? undefined : release.cursorPos,
        });
    }

    private readonly onPointerCancel = (event: PointerEvent): void => {
        if (this.gesture?.pointerId === event.pointerId) {
            this.finishGesture();
        }
    };

    constructor(private readonly view: EditorView) {
        this.autoScroller = new CellDragAutoScroller(view);
    }

    begin(
        event: PointerEvent,
        cell: HTMLElement,
        resolvedCell: ResolvedActiveCell,
        origin: MouseCellGestureOrigin
    ): boolean {
        if (!isPrimaryMousePointer(event)) {
            return false;
        }

        const widget = cell.closest(getWidgetSelector()) as HTMLElement | null;
        const table = cell.closest('table') as HTMLTableElement | null;
        if (!widget || !table || table.closest(getWidgetSelector()) !== widget) {
            return false;
        }

        const pressCaretHit =
            origin === 'renderedCell' ? readRenderedCaretHit(cell, event.clientX, event.clientY) : null;

        this.beginGesture({
            origin,
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
            pressCaretHit,
            lastHeadHit: null,
        });

        if (origin === 'renderedCell') {
            // The gesture owns the DOM selection from here. Collapse it at the pressed caret,
            // or drop whatever was standing when the press had no caret to offer.
            if (pressCaretHit) {
                setRenderedTextSelection(cell, pressCaretHit, pressCaretHit);
            } else {
                this.view.dom.ownerDocument.getSelection()?.removeAllRanges();
            }
        }

        return true;
    }

    /** True when the compatibility mousedown behind a press this gesture owns should be taken. */
    consumesCompatibilityMouseDown(event: MouseEvent): boolean {
        return Boolean(this.gesture && isPrimaryMouseButton(event) && ORIGIN_CONSUMES_PRESS[this.gesture.origin]);
    }

    destroy(): void {
        // Dispatching from a destroy hook is not safe. `cellDragField` clears itself once its
        // selection goes, so nothing needs to be cleared here.
        this.detachGesture();
    }

    private resolveCellAtPoint(event: PointerEvent, gesture: MouseCellGesture): CellCoords | null {
        return this.resolveCellAtClientPoint(event.clientX, event.clientY, gesture);
    }

    /**
     * The cell a press has moved far enough into to make the gesture a rectangle, or null while
     * it still belongs to the cell it started in.
     *
     * Only another cell promotes a press, and only past a threshold that keeps a jittering
     * pointer from tearing down what it landed on. A press that owns the nested editor measures
     * from the anchor cell's border, so its own text-selection drag survives a pointer that
     * merely grazes the neighbour; every other press measures from where it started.
     */
    private promotionTarget(
        gesture: MouseCellGesture,
        event: PointerEvent,
        pointedCell: CellCoords | null
    ): CellCoords | null {
        if (!pointedCell || isSameCellCoords(gesture.resolvedCell.activeCell, pointedCell)) {
            return null;
        }

        const moved = ownsNestedEditor(gesture.origin)
            ? distanceOutsideRectSquared(event.clientX, event.clientY, gesture.anchorCell.getBoundingClientRect()) >=
              BOUNDARY_EXIT_DISTANCE_SQUARED
            : distanceSquared(event.clientX, event.clientY, gesture.startX, gesture.startY) >=
              DRAG_START_DISTANCE_SQUARED;

        return moved ? pointedCell : null;
    }

    /** Extends the range the press is drawing to the caret the pointer now rests on. */
    private updateRenderedTextSelection(gesture: MouseCellGesture): void {
        const anchor = gesture.pressCaretHit;
        if (!anchor) {
            return;
        }

        const head = readRenderedCaretHit(gesture.anchorCell, gesture.lastClientX, gesture.lastClientY);
        if (head) {
            gesture.lastHeadHit = head;
            setRenderedTextSelection(gesture.anchorCell, anchor, head);
        }
    }

    private resolveCellAtClientPoint(clientX: number, clientY: number, gesture: MouseCellGesture): CellCoords | null {
        const element = this.view.dom.ownerDocument.elementFromPoint(clientX, clientY);
        const cell = element?.closest(SELECTOR_CELL) as HTMLElement | null;
        if (!cell || cell.closest(getWidgetSelector()) !== gesture.widget) {
            return null;
        }

        return readCellCoords(cell);
    }

    /** Resolves the pressed anchor from the widget's current document position. */
    private resolveCurrentRenderedAnchor(gesture: MouseCellGesture): ResolvedActiveCell | null {
        if (!gesture.widget.isConnected || !this.view.dom.contains(gesture.widget)) {
            return null;
        }

        try {
            const tablePos = this.view.posAtDOM(gesture.widget, 0);
            const ctx = resolveTableContextAtPos(this.view.state, tablePos);
            return ctx
                ? createResolvedActiveCell({
                      ctx,
                      coords: gesture.resolvedCell.activeCell,
                  })
                : null;
        } catch {
            // A replaced or detached widget cannot safely identify the table that was pressed.
            return null;
        }
    }

    private resolveVisibleCellAtPointer(gesture: MouseCellGesture): CellCoords | null {
        const tableRect = gesture.table.getBoundingClientRect();
        const widgetRect = gesture.widget.getBoundingClientRect();
        const scrollRect = this.view.scrollDOM.getBoundingClientRect();
        // Vertically the scroller rect is not the visible band when the page scrolls instead.
        const verticalBounds = resolveViewportBounds(scrollRect, getViewportHeight(getViewWindow(this.view)));
        const left = Math.max(tableRect.left, widgetRect.left, scrollRect.left);
        const right = Math.min(tableRect.right, widgetRect.right, scrollRect.right);
        const top = Math.max(tableRect.top, widgetRect.top, verticalBounds.top);
        const bottom = Math.min(tableRect.bottom, widgetRect.bottom, verticalBounds.bottom);
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
        doc.addEventListener('pointermove', this.onPointerMove, true);
        doc.addEventListener('pointerup', this.onPointerUp, true);
        doc.addEventListener('pointercancel', this.onPointerCancel, true);
    }

    /**
     * Ends CodeMirror's native text-selection drag in the cell the gesture started from.
     *
     * Its move handler tears the drag down on the first move with no button held, which also
     * clears the interval driving its own edge scrolling. Starving that handler of events
     * would leave the interval running, scrolling the cell against the table's auto-scroll.
     */
    private endNativeTextDrag(event: PointerEvent): void {
        const win = getViewWindow(this.view) as Window & { MouseEvent?: typeof MouseEvent };
        const MouseEventCtor = win.MouseEvent ?? MouseEvent;
        this.view.dom.ownerDocument.dispatchEvent(
            new MouseEventCtor('mousemove', {
                bubbles: true,
                clientX: event.clientX,
                clientY: event.clientY,
                buttons: 0,
            })
        );
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

    private finishGesture(options: { keepActiveCell?: boolean; focusSelection?: boolean } = {}): void {
        const gesture = this.detachGesture();
        if (!gesture?.dragged) {
            return;
        }

        // The rectangle is final and pointer hit-testing is over, so the deferred teardown of
        // the cell that stayed open through the drag can run without moving the table.
        endCellDragSelection(this.view, { keepActiveCell: Boolean(options.keepActiveCell) });
        if (options.focusSelection && getCellSelection(this.view.state)) {
            // Preventing the initial pointerdown kept the browser from focusing CodeMirror.
            // Transfer ownership now that the rectangle is final and ready for commands.
            this.view.focus();
        }
    }
}

export const mouseCellDragSelectionPlugin = ViewPlugin.fromClass(MouseCellDragSelectionController);

/**
 * Starts a gesture for a press on `cell`, and reports whether that press is taken from the editor.
 *
 * The answer is returned rather than applied, so one router decides what happens to every press
 * it sees; see `tableWidget/tableWidgetInteractions.ts`.
 */
export function beginMouseCellGesture(
    view: EditorView,
    event: PointerEvent,
    cell: HTMLElement,
    resolvedCell: ResolvedActiveCell,
    origin: MouseCellGestureOrigin
): boolean {
    const started = view.plugin?.(mouseCellDragSelectionPlugin)?.begin(event, cell, resolvedCell, origin) ?? false;
    return started && ORIGIN_CONSUMES_PRESS[origin];
}

/** True when the compatibility mousedown behind a running gesture's press should be taken. */
export function mouseCellGestureConsumesMouseDown(view: EditorView, event: MouseEvent): boolean {
    return view.plugin?.(mouseCellDragSelectionPlugin)?.consumesCompatibilityMouseDown(event) ?? false;
}

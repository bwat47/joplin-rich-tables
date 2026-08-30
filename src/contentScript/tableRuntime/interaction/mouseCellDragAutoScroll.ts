import type { EditorView } from '@codemirror/view';
import { getViewWindow, requestViewAnimationFrame } from '../../shared/domContext';
import { clamp } from '../../shared/numberUtils';

const EDGE_SCROLL_ZONE_PX = 48;
const EDGE_SCROLL_MAX_SPEED_PX_PER_SECOND = 900;
const EDGE_SCROLL_DEFAULT_FRAME_MS = 1000 / 60;
const EDGE_SCROLL_MAX_FRAME_MS = 50;
// A zero-length frame would produce a zero delta, which the loop cannot tell apart
// from having reached a scroll boundary.
const EDGE_SCROLL_MIN_FRAME_MS = 1;

export interface AutoScrollContext {
    /** The table widget: the horizontal scroller, and the range the pointer's X is measured against. */
    widget: HTMLElement;
    /** The rendered table, used to stop vertical scrolling once none of it is left off-screen. */
    table: HTMLElement;
    /** Latest pointer position, read fresh on each frame. */
    pointer: () => { x: number; y: number };
    /** Runs after a frame that actually scrolled, so the caller can re-resolve what the pointer is over. */
    onScrolled: () => void;
}

/**
 * Vertical bounds of the band a drag scrolls toward, in client coordinates.
 *
 * CodeMirror scrolls internally on desktop, but the web app scrolls the page instead and lets
 * `scrollDOM` grow to the full document height. Intersecting the two leaves the visible band
 * either way: the desktop scroller already sits inside the window, so this returns its rect.
 */
export function resolveVerticalScrollBounds(view: EditorView): { top: number; bottom: number } {
    const scrollRect = view.scrollDOM.getBoundingClientRect();
    const viewWindow = getViewWindow(view);
    const viewportHeight = viewWindow.visualViewport?.height ?? viewWindow.innerHeight;

    return {
        top: Math.max(scrollRect.top, 0),
        bottom: Math.min(scrollRect.bottom, viewportHeight),
    };
}

/** The element that scrolls the page when the editor does not scroll internally. */
function getPageScroller(view: EditorView): HTMLElement | null {
    const doc = view.dom.ownerDocument;
    return (doc.scrollingElement ?? doc.documentElement) as HTMLElement | null;
}

/**
 * Returns edge-scroll intensity from -1 (toward the start edge) to 1 (toward
 * the end edge). Positions outside the range stay at full intensity.
 */
export function calculateEdgeScrollIntensity(
    position: number,
    rangeStart: number,
    rangeEnd: number,
    edgeSize: number
): number {
    if (rangeEnd <= rangeStart || edgeSize <= 0) {
        return 0;
    }

    const effectiveEdgeSize = Math.min(edgeSize, (rangeEnd - rangeStart) / 2);
    const startEdgeEnd = rangeStart + effectiveEdgeSize;
    if (position < startEdgeEnd) {
        return -Math.min(1, (startEdgeEnd - position) / effectiveEdgeSize);
    }

    const endEdgeStart = rangeEnd - effectiveEdgeSize;
    if (position > endEdgeStart) {
        return Math.min(1, (position - endEdgeStart) / effectiveEdgeSize);
    }

    return 0;
}

function applyScrollDelta(element: HTMLElement, axis: 'horizontal' | 'vertical', delta: number): boolean {
    const current = axis === 'horizontal' ? element.scrollLeft : element.scrollTop;
    const scrollSize = axis === 'horizontal' ? element.scrollWidth : element.scrollHeight;
    const clientSize = axis === 'horizontal' ? element.clientWidth : element.clientHeight;
    const next = clamp(current + delta, 0, Math.max(0, scrollSize - clientSize));
    if (next === current) {
        return false;
    }

    if (axis === 'horizontal') {
        element.scrollLeft = next;
    } else {
        element.scrollTop = next;
    }
    return true;
}

/**
 * Scrolls the table toward whichever edge a held cell drag is resting against.
 *
 * The loop runs only while it is making progress: a frame that moves neither axis has
 * reached a boundary, so it stops until the next pointer move restarts it.
 */
export class CellDragAutoScroller {
    private frameId: number | null = null;
    private lastTimestamp: number | null = null;

    constructor(private readonly view: EditorView) {}

    schedule(context: AutoScrollContext): void {
        if (this.frameId !== null) {
            return;
        }

        this.frameId = requestViewAnimationFrame(this.view, (timestamp) => {
            this.frameId = null;
            this.runFrame(context, timestamp);
        });
    }

    cancel(): void {
        if (this.frameId !== null) {
            getViewWindow(this.view).cancelAnimationFrame(this.frameId);
            this.frameId = null;
        }
        this.lastTimestamp = null;
    }

    private runFrame(context: AutoScrollContext, timestamp: number): void {
        const pointer = context.pointer();
        const widgetRect = context.widget.getBoundingClientRect();
        const tableRect = context.table.getBoundingClientRect();
        const verticalBounds = resolveVerticalScrollBounds(this.view);

        const horizontalIntensity = calculateEdgeScrollIntensity(
            pointer.x,
            widgetRect.left,
            widgetRect.right,
            EDGE_SCROLL_ZONE_PX
        );
        let verticalIntensity = calculateEdgeScrollIntensity(
            pointer.y,
            verticalBounds.top,
            verticalBounds.bottom,
            EDGE_SCROLL_ZONE_PX
        );
        if (
            (verticalIntensity < 0 && tableRect.top >= verticalBounds.top) ||
            (verticalIntensity > 0 && tableRect.bottom <= verticalBounds.bottom)
        ) {
            verticalIntensity = 0;
        }

        const elapsedMs =
            this.lastTimestamp === null
                ? EDGE_SCROLL_DEFAULT_FRAME_MS
                : clamp(timestamp - this.lastTimestamp, EDGE_SCROLL_MIN_FRAME_MS, EDGE_SCROLL_MAX_FRAME_MS);
        this.lastTimestamp = timestamp;
        const maxDelta = (EDGE_SCROLL_MAX_SPEED_PX_PER_SECOND * elapsedMs) / 1000;

        // The widget is the table's horizontal scroller. Vertically the editor's own scroller
        // wins where it can move, and the page takes over where it cannot — which is every
        // frame in the web app, whose editor does not scroll internally at all.
        const verticalDelta = verticalIntensity * maxDelta;
        const pageScroller = getPageScroller(this.view);
        const didScrollHorizontally = applyScrollDelta(context.widget, 'horizontal', horizontalIntensity * maxDelta);
        const didScrollVertically =
            applyScrollDelta(this.view.scrollDOM, 'vertical', verticalDelta) ||
            (pageScroller !== null && applyScrollDelta(pageScroller, 'vertical', verticalDelta));
        if (!didScrollHorizontally && !didScrollVertically) {
            this.lastTimestamp = null;
            return;
        }

        context.onScrolled();
        this.schedule(context);
    }
}

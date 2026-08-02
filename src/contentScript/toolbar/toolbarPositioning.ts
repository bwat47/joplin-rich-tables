import { clamp } from '../shared/numberUtils';

export const TOOLBAR_OFFSET_PX = 5;
export const TOOLBAR_VIEWPORT_PADDING_PX = 5;
const TOOLBAR_OBSCURATION_THRESHOLD_PX = 5;

/** Subset of `DOMRect` used by the toolbar geometry. `DOMRect` is assignable to it. */
export interface ToolbarRect {
    top: number;
    bottom: number;
    left: number;
    width: number;
    height: number;
}

/** Vertical bounds of the area the toolbar must stay inside, in viewport coordinates. */
export interface ViewportBounds {
    top: number;
    bottom: number;
    height: number;
}

export interface ToolbarPoint {
    x: number;
    y: number;
}

/** Where the toolbar ends up, plus the CSS positioning strategy required to render it there. */
export interface ToolbarPlacement extends ToolbarPoint {
    strategy: 'absolute' | 'fixed';
}

/**
 * Anchored placements are handed to Floating UI; `pinned` means the table edge we would
 * anchor to is off-screen, so the toolbar sticks to the viewport edge instead.
 */
export type ToolbarPlacementMode = 'top-start' | 'bottom-start' | 'pinned';

/**
 * Desktop uses internal CodeMirror scrolling, so the visible area is the scroller rect.
 * Mobile scrolls the surrounding WebView, so the visible area is the window/visual viewport
 * anchored to the top of the page.
 */
export function resolveViewportBounds(
    isInternalScroll: boolean,
    scrollDOMRect: ToolbarRect,
    externalViewportHeight: number
): ViewportBounds {
    if (isInternalScroll) {
        return { top: scrollDOMRect.top, bottom: scrollDOMRect.bottom, height: scrollDOMRect.height };
    }

    return { top: 0, bottom: externalViewportHeight, height: externalViewportHeight };
}

/** True when the table has scrolled entirely past either viewport edge. */
export function isTableOutsideViewport(tableRect: ToolbarRect, viewport: ViewportBounds): boolean {
    const tableAboveViewport = tableRect.bottom <= viewport.top;
    const tableBelowViewport = tableRect.top >= viewport.bottom;

    return tableAboveViewport || tableBelowViewport;
}

/**
 * Prefers anchoring above the table, then below it, and falls back to pinning when neither
 * table edge is both visible and has room for the toolbar.
 */
export function resolveToolbarPlacementMode(
    tableRect: ToolbarRect,
    toolbarHeight: number,
    viewport: ViewportBounds
): ToolbarPlacementMode {
    const topVisible = tableRect.top >= viewport.top && tableRect.top <= viewport.bottom;
    const hasRoomAbove =
        tableRect.top - toolbarHeight - TOOLBAR_OFFSET_PX >= viewport.top + TOOLBAR_VIEWPORT_PADDING_PX;
    if (topVisible && hasRoomAbove) {
        return 'top-start';
    }

    const bottomVisible = tableRect.bottom >= viewport.top && tableRect.bottom <= viewport.bottom;
    const hasRoomBelow =
        viewport.bottom - tableRect.bottom - toolbarHeight - TOOLBAR_OFFSET_PX >= TOOLBAR_VIEWPORT_PADDING_PX;
    if (bottomVisible && hasRoomBelow) {
        return 'bottom-start';
    }

    return 'pinned';
}

/** Pins to whichever viewport edge the table's midpoint has scrolled away from. */
export function shouldPinAbove(tableRect: ToolbarRect, viewport: ViewportBounds): boolean {
    return (tableRect.top + tableRect.bottom) / 2 > viewport.top + viewport.height / 2;
}

/**
 * Desktop (internal scroll) pinning: `position: absolute` coordinates relative to the toolbar's
 * offset parent, kept within the editor panel bounds.
 */
export function computePinnedAbsolutePlacement(params: {
    tableRect: ToolbarRect;
    toolbarRect: ToolbarRect;
    viewport: ViewportBounds;
    viewRect: ToolbarRect;
    offsetParentTop: number;
    pinAbove: boolean;
}): ToolbarPlacement {
    const { tableRect, toolbarRect, viewport, viewRect, offsetParentTop, pinAbove } = params;

    const maxX = Math.max(
        TOOLBAR_VIEWPORT_PADDING_PX,
        viewRect.width - toolbarRect.width - TOOLBAR_VIEWPORT_PADDING_PX
    );
    const x = clamp(tableRect.left - viewRect.left, TOOLBAR_VIEWPORT_PADDING_PX, maxX);

    const topInParent = viewport.top - offsetParentTop + TOOLBAR_VIEWPORT_PADDING_PX;
    const bottomInParent = viewport.bottom - offsetParentTop - toolbarRect.height - TOOLBAR_VIEWPORT_PADDING_PX;
    const y = pinAbove ? topInParent : Math.max(topInParent, bottomInParent);

    return { x, y, strategy: 'absolute' };
}

/**
 * Mobile (external scroll) pinning: `position: fixed` viewport-relative coordinates, which avoid
 * the jitter caused by offset parent recalculations during scroll.
 * The mobile editor disables pinch-zoom (maximum-scale=1), so the page offset is always 0.
 */
export function computePinnedFixedPlacement(params: {
    tableRect: ToolbarRect;
    toolbarRect: ToolbarRect;
    viewport: ViewportBounds;
    viewportWidth: number;
    pinAbove: boolean;
}): ToolbarPlacement {
    const { tableRect, toolbarRect, viewport, viewportWidth, pinAbove } = params;

    const maxX = Math.max(TOOLBAR_VIEWPORT_PADDING_PX, viewportWidth - toolbarRect.width - TOOLBAR_VIEWPORT_PADDING_PX);
    const x = clamp(tableRect.left, TOOLBAR_VIEWPORT_PADDING_PX, maxX);

    const y = pinAbove
        ? viewport.top + TOOLBAR_VIEWPORT_PADDING_PX
        : viewport.bottom - toolbarRect.height - TOOLBAR_VIEWPORT_PADDING_PX;

    return { x, y, strategy: 'fixed' };
}

/** Guards against rendering a `NaN`/`Infinity` position produced by degenerate measurements. */
export function isFinitePoint(point: ToolbarPoint): boolean {
    return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/**
 * A toolbar anchored to the top of a table that lands within a few pixels of the viewport top
 * obscures the table; the caller retries below in that case.
 */
export function isObscuringTopPlacement(placement: string, y: number): boolean {
    return placement.startsWith('top') && y < TOOLBAR_OBSCURATION_THRESHOLD_PX;
}

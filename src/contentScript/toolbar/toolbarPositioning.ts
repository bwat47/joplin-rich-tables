import type { ViewportBounds } from '../shared/editorViewport';
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
export type ToolbarPlacementMode = 'top' | 'bottom' | 'pinned';

/**
 * The box the toolbar anchors to, combining both elements the widget is made of:
 *
 * - Horizontally, the table clipped to the widget root, which scrolls the table when it is wider
 *   than the editor. Centring on that slice keeps the toolbar over the part of the table that is
 *   actually on screen instead of over an off-screen midpoint.
 * - Vertically, the widget root, whose border box also covers the horizontal scrollbar the root
 *   renders when the table overflows. Anchoring to the table itself would sit the toolbar on top
 *   of that scrollbar, at whatever width the host theme gives it.
 */
export function resolveToolbarAnchorRect(tableRect: ToolbarRect, widgetRect: ToolbarRect): ToolbarRect {
    const left = Math.max(tableRect.left, widgetRect.left);
    const right = Math.min(tableRect.left + tableRect.width, widgetRect.left + widgetRect.width);

    // Built field by field, not spread: callers pass a `DOMRect`, whose properties live on the
    // prototype, so spreading one would silently drop every bound it is meant to carry.
    return {
        top: widgetRect.top,
        bottom: widgetRect.bottom,
        height: widgetRect.height,
        left,
        width: Math.max(0, right - left),
    };
}

/** True when the table has scrolled entirely past either viewport edge. */
export function isTableOutsideViewport(anchorRect: ToolbarRect, viewport: ViewportBounds): boolean {
    const tableAboveViewport = anchorRect.bottom <= viewport.top;
    const tableBelowViewport = anchorRect.top >= viewport.bottom;

    return tableAboveViewport || tableBelowViewport;
}

/**
 * Prefers anchoring above the table, then below it, and falls back to pinning when neither
 * table edge is both visible and has room for the toolbar.
 */
export function resolveToolbarPlacementMode(
    anchorRect: ToolbarRect,
    toolbarHeight: number,
    viewport: ViewportBounds
): ToolbarPlacementMode {
    const topVisible = anchorRect.top >= viewport.top && anchorRect.top <= viewport.bottom;
    const hasRoomAbove =
        anchorRect.top - toolbarHeight - TOOLBAR_OFFSET_PX >= viewport.top + TOOLBAR_VIEWPORT_PADDING_PX;
    if (topVisible && hasRoomAbove) {
        return 'top';
    }

    const bottomVisible = anchorRect.bottom >= viewport.top && anchorRect.bottom <= viewport.bottom;
    const hasRoomBelow =
        viewport.bottom - anchorRect.bottom - toolbarHeight - TOOLBAR_OFFSET_PX >= TOOLBAR_VIEWPORT_PADDING_PX;
    if (bottomVisible && hasRoomBelow) {
        return 'bottom';
    }

    return 'pinned';
}

/** Pins to whichever viewport edge the table's midpoint has scrolled away from. */
export function shouldPinAbove(anchorRect: ToolbarRect, viewport: ViewportBounds): boolean {
    return (anchorRect.top + anchorRect.bottom) / 2 > viewport.top + viewport.height / 2;
}

/**
 * Centres the toolbar on the table horizontally, in coordinates relative to `containerLeft`,
 * clamped so the toolbar stays inside `containerWidth`.
 */
function computeCenteredX(params: {
    anchorRect: ToolbarRect;
    toolbarWidth: number;
    containerLeft: number;
    containerWidth: number;
}): number {
    const { anchorRect, toolbarWidth, containerLeft, containerWidth } = params;

    const maxX = Math.max(TOOLBAR_VIEWPORT_PADDING_PX, containerWidth - toolbarWidth - TOOLBAR_VIEWPORT_PADDING_PX);
    const centeredX = anchorRect.left - containerLeft + anchorRect.width / 2 - toolbarWidth / 2;

    return clamp(centeredX, TOOLBAR_VIEWPORT_PADDING_PX, maxX);
}

/**
 * Desktop (internal scroll) pinning: `position: absolute` coordinates relative to the toolbar's
 * offset parent, kept within the editor panel bounds.
 */
export function computePinnedAbsolutePlacement(params: {
    anchorRect: ToolbarRect;
    toolbarRect: ToolbarRect;
    viewport: ViewportBounds;
    viewRect: ToolbarRect;
    offsetParentTop: number;
    pinAbove: boolean;
}): ToolbarPlacement {
    const { anchorRect, toolbarRect, viewport, viewRect, offsetParentTop, pinAbove } = params;

    const x = computeCenteredX({
        anchorRect,
        toolbarWidth: toolbarRect.width,
        containerLeft: viewRect.left,
        containerWidth: viewRect.width,
    });

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
    anchorRect: ToolbarRect;
    toolbarRect: ToolbarRect;
    viewport: ViewportBounds;
    viewportWidth: number;
    pinAbove: boolean;
}): ToolbarPlacement {
    const { anchorRect, toolbarRect, viewport, viewportWidth, pinAbove } = params;

    const x = computeCenteredX({
        anchorRect,
        toolbarWidth: toolbarRect.width,
        containerLeft: 0,
        containerWidth: viewportWidth,
    });

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

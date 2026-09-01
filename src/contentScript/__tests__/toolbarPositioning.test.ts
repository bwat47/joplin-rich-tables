import { describe, expect, it } from 'vitest';
import {
    computePinnedAbsolutePlacement,
    computePinnedFixedPlacement,
    isFinitePoint,
    isObscuringTopPlacement,
    isTableOutsideViewport,
    resolveToolbarAnchorRect,
    resolveToolbarPlacementMode,
    shouldPinAbove,
    TOOLBAR_VIEWPORT_PADDING_PX,
    type ToolbarRect,
} from '../toolbar/toolbarPositioning';
import type { ViewportBounds } from '../shared/editorViewport';

function rect(partial: Partial<ToolbarRect>): ToolbarRect {
    return { top: 0, bottom: 0, left: 0, width: 0, height: 0, ...partial };
}

/**
 * Mimics a real `DOMRect`, which exposes its values as prototype accessors rather than own
 * properties. The toolbar measures with `getBoundingClientRect()`, so clipping must read fields
 * explicitly instead of spreading.
 */
function domRectLike(partial: Partial<ToolbarRect>): ToolbarRect {
    const prototype = {};
    for (const [key, value] of Object.entries(rect(partial))) {
        Object.defineProperty(prototype, key, { get: () => value, enumerable: false });
    }

    return Object.create(prototype) as ToolbarRect;
}

const TOOLBAR_HEIGHT = 30;

describe('resolveToolbarAnchorRect', () => {
    const widgetRect = rect({ top: 0, bottom: 90, height: 90, left: 100, width: 600 });

    it('centres horizontally on a table narrower than its widget', () => {
        const anchor = resolveToolbarAnchorRect(rect({ top: 8, bottom: 70, left: 100, width: 200 }), widgetRect);

        expect(anchor.left).toBe(100);
        expect(anchor.width).toBe(200);
    });

    it('clips a table wider than its widget to the visible slice', () => {
        const anchor = resolveToolbarAnchorRect(rect({ top: 8, bottom: 70, left: 100, width: 2000 }), widgetRect);

        expect(anchor.left).toBe(100);
        expect(anchor.width).toBe(600);
    });

    it('follows the visible slice when the table is scrolled horizontally', () => {
        const anchor = resolveToolbarAnchorRect(rect({ top: 8, bottom: 70, left: -400, width: 2000 }), widgetRect);

        expect(anchor.left).toBe(100);
        expect(anchor.width).toBe(600);
    });

    it('takes its vertical bounds from the widget, which covers the horizontal scrollbar', () => {
        // The widget extends 20px below the table: its padding plus the scrollbar the overflowing
        // table makes it render. Anchoring to the table would put the toolbar over that scrollbar.
        const anchor = resolveToolbarAnchorRect(rect({ top: 8, bottom: 70, left: 100, width: 2000 }), widgetRect);

        expect(anchor.top).toBe(0);
        expect(anchor.bottom).toBe(90);
        expect(anchor.height).toBe(90);
    });

    it('keeps the bounds of DOMRects, whose values are prototype accessors', () => {
        const anchor = resolveToolbarAnchorRect(
            domRectLike({ top: 8, bottom: 70, height: 62, left: -400, width: 2000 }),
            domRectLike({ top: 0, bottom: 90, height: 90, left: 100, width: 600 })
        );

        expect(anchor).toEqual({ top: 0, bottom: 90, height: 90, left: 100, width: 600 });
    });

    it('reports zero width when the rects do not overlap', () => {
        const anchor = resolveToolbarAnchorRect(rect({ left: 5000, width: 100 }), widgetRect);

        expect(anchor.width).toBe(0);
    });
});

describe('isTableOutsideViewport', () => {
    const viewport: ViewportBounds = { top: 100, bottom: 500, height: 400 };

    it('reports a table scrolled above the viewport', () => {
        expect(isTableOutsideViewport(rect({ top: 20, bottom: 100 }), viewport)).toBe(true);
    });

    it('reports a table scrolled below the viewport', () => {
        expect(isTableOutsideViewport(rect({ top: 500, bottom: 600 }), viewport)).toBe(true);
    });

    it('does not report a partially visible table', () => {
        expect(isTableOutsideViewport(rect({ top: 20, bottom: 200 }), viewport)).toBe(false);
    });
});

describe('resolveToolbarPlacementMode', () => {
    const viewport: ViewportBounds = { top: 100, bottom: 500, height: 400 };

    it('anchors above when the table top is visible with room for the toolbar', () => {
        const tableRect = rect({ top: 200, bottom: 300 });

        expect(resolveToolbarPlacementMode(tableRect, TOOLBAR_HEIGHT, viewport)).toBe('top');
    });

    it('anchors below when the table top is visible but crowded against the viewport top', () => {
        const tableRect = rect({ top: 110, bottom: 300 });

        expect(resolveToolbarPlacementMode(tableRect, TOOLBAR_HEIGHT, viewport)).toBe('bottom');
    });

    it('pins when neither table edge has room', () => {
        const tableRect = rect({ top: 110, bottom: 490 });

        expect(resolveToolbarPlacementMode(tableRect, TOOLBAR_HEIGHT, viewport)).toBe('pinned');
    });

    it('pins when the table top has scrolled out of view and the bottom is crowded', () => {
        const tableRect = rect({ top: -50, bottom: 495 });

        expect(resolveToolbarPlacementMode(tableRect, TOOLBAR_HEIGHT, viewport)).toBe('pinned');
    });

    it('anchors below when the table top is out of view but the bottom has room', () => {
        const tableRect = rect({ top: -50, bottom: 300 });

        expect(resolveToolbarPlacementMode(tableRect, TOOLBAR_HEIGHT, viewport)).toBe('bottom');
    });
});

describe('shouldPinAbove', () => {
    const viewport: ViewportBounds = { top: 100, bottom: 500, height: 400 };

    it('pins to the top edge when the table midpoint is below the viewport midpoint', () => {
        expect(shouldPinAbove(rect({ top: 350, bottom: 900 }), viewport)).toBe(true);
    });

    it('pins to the bottom edge when the table midpoint is above the viewport midpoint', () => {
        expect(shouldPinAbove(rect({ top: -400, bottom: 200 }), viewport)).toBe(false);
    });
});

describe('computePinnedAbsolutePlacement', () => {
    const base = {
        toolbarRect: rect({ width: 200, height: TOOLBAR_HEIGHT }),
        viewport: { top: 100, bottom: 500, height: 400 } as ViewportBounds,
        viewRect: rect({ top: 100, left: 50, width: 600, height: 400 }),
        offsetParentTop: 80,
    };

    it('centres on the table and positions against the top edge relative to the offset parent', () => {
        const placement = computePinnedAbsolutePlacement({
            ...base,
            anchorRect: rect({ top: 350, bottom: 900, left: 120, width: 300 }),
            pinAbove: true,
        });

        // Table centre is 270, which is 220 relative to the panel; the 200px toolbar starts at 120.
        expect(placement).toEqual({ x: 120, y: 25, strategy: 'absolute' });
    });

    it('centres on the table and positions against the bottom edge when pinning below', () => {
        const placement = computePinnedAbsolutePlacement({
            ...base,
            anchorRect: rect({ top: -400, bottom: 200, left: 120, width: 300 }),
            pinAbove: false,
        });

        expect(placement).toEqual({ x: 120, y: 385, strategy: 'absolute' });
    });

    it('clamps the toolbar inside the editor panel', () => {
        const placement = computePinnedAbsolutePlacement({
            ...base,
            anchorRect: rect({ top: 350, bottom: 900, left: 5000, width: 300 }),
            pinAbove: true,
        });

        expect(placement.x).toBe(600 - 200 - TOOLBAR_VIEWPORT_PADDING_PX);
    });

    it('clamps to the left padding when centring a narrow table would overflow the panel', () => {
        const placement = computePinnedAbsolutePlacement({
            ...base,
            anchorRect: rect({ top: 350, bottom: 900, left: 50, width: 60 }),
            pinAbove: true,
        });

        expect(placement.x).toBe(TOOLBAR_VIEWPORT_PADDING_PX);
    });

    it('falls back to the padding when the panel is narrower than the toolbar', () => {
        const placement = computePinnedAbsolutePlacement({
            ...base,
            viewRect: rect({ top: 100, left: 50, width: 100, height: 400 }),
            anchorRect: rect({ top: 350, bottom: 900, left: 5000, width: 300 }),
            pinAbove: true,
        });

        expect(placement.x).toBe(TOOLBAR_VIEWPORT_PADDING_PX);
    });

    it('never pins above the viewport top when the bottom edge would be higher', () => {
        const placement = computePinnedAbsolutePlacement({
            ...base,
            viewport: { top: 100, bottom: 110, height: 10 },
            anchorRect: rect({ top: -400, bottom: 105, left: 120 }),
            pinAbove: false,
        });

        // bottomInParent would be 110 - 80 - 30 - 5 = -5, so the top edge wins.
        expect(placement.y).toBe(25);
    });
});

describe('computePinnedFixedPlacement', () => {
    const base = {
        toolbarRect: rect({ width: 200, height: TOOLBAR_HEIGHT }),
        viewport: { top: 0, bottom: 800, height: 800 } as ViewportBounds,
        viewportWidth: 400,
    };

    it('centres on the table in viewport-relative coordinates when pinning above', () => {
        const placement = computePinnedFixedPlacement({
            ...base,
            anchorRect: rect({ top: 500, bottom: 1200, left: 30, width: 340 }),
            pinAbove: true,
        });

        // Table centre is 200, so the 200px toolbar starts at 100.
        expect(placement).toEqual({ x: 100, y: 5, strategy: 'fixed' });
    });

    it('centres on the table in viewport-relative coordinates when pinning below', () => {
        const placement = computePinnedFixedPlacement({
            ...base,
            anchorRect: rect({ top: -500, bottom: 300, left: 30, width: 340 }),
            pinAbove: false,
        });

        expect(placement).toEqual({ x: 100, y: 765, strategy: 'fixed' });
    });

    it('clamps the toolbar inside the viewport width', () => {
        const placement = computePinnedFixedPlacement({
            ...base,
            anchorRect: rect({ top: 500, bottom: 1200, left: 380, width: 340 }),
            pinAbove: true,
        });

        expect(placement.x).toBe(400 - 200 - TOOLBAR_VIEWPORT_PADDING_PX);
    });

    it('clamps to the left padding when centring a narrow table would overflow the viewport', () => {
        const placement = computePinnedFixedPlacement({
            ...base,
            anchorRect: rect({ top: 500, bottom: 1200, left: -60, width: 120 }),
            pinAbove: true,
        });

        expect(placement.x).toBe(TOOLBAR_VIEWPORT_PADDING_PX);
    });
});

describe('isFinitePoint', () => {
    it('accepts finite coordinates', () => {
        expect(isFinitePoint({ x: 0, y: -12.5 })).toBe(true);
    });

    it('rejects NaN and Infinity coordinates', () => {
        expect(isFinitePoint({ x: Number.NaN, y: 0 })).toBe(false);
        expect(isFinitePoint({ x: 0, y: Number.POSITIVE_INFINITY })).toBe(false);
    });
});

describe('isObscuringTopPlacement', () => {
    it('flags a top placement pushed against the viewport top', () => {
        expect(isObscuringTopPlacement('top', 2)).toBe(true);
    });

    it('ignores a top placement with clearance', () => {
        expect(isObscuringTopPlacement('top', 40)).toBe(false);
    });

    it('ignores bottom placements', () => {
        expect(isObscuringTopPlacement('bottom', 0)).toBe(false);
    });
});

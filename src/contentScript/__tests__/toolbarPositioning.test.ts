import { describe, expect, it } from 'vitest';
import {
    computePinnedAbsolutePlacement,
    computePinnedFixedPlacement,
    isFinitePoint,
    isObscuringTopPlacement,
    isTableOutsideViewport,
    resolveToolbarPlacementMode,
    shouldPinAbove,
    TOOLBAR_VIEWPORT_PADDING_PX,
    type ToolbarRect,
} from '../toolbar/toolbarPositioning';
import type { ViewportBounds } from '../shared/editorViewport';

function rect(partial: Partial<ToolbarRect>): ToolbarRect {
    return { top: 0, bottom: 0, left: 0, width: 0, height: 0, ...partial };
}

const TOOLBAR_HEIGHT = 30;

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

        expect(resolveToolbarPlacementMode(tableRect, TOOLBAR_HEIGHT, viewport)).toBe('top-start');
    });

    it('anchors below when the table top is visible but crowded against the viewport top', () => {
        const tableRect = rect({ top: 110, bottom: 300 });

        expect(resolveToolbarPlacementMode(tableRect, TOOLBAR_HEIGHT, viewport)).toBe('bottom-start');
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

        expect(resolveToolbarPlacementMode(tableRect, TOOLBAR_HEIGHT, viewport)).toBe('bottom-start');
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

    it('positions against the top edge relative to the offset parent', () => {
        const placement = computePinnedAbsolutePlacement({
            ...base,
            tableRect: rect({ top: 350, bottom: 900, left: 120 }),
            pinAbove: true,
        });

        expect(placement).toEqual({ x: 70, y: 25, strategy: 'absolute' });
    });

    it('positions against the bottom edge when pinning below', () => {
        const placement = computePinnedAbsolutePlacement({
            ...base,
            tableRect: rect({ top: -400, bottom: 200, left: 120 }),
            pinAbove: false,
        });

        expect(placement).toEqual({ x: 70, y: 385, strategy: 'absolute' });
    });

    it('clamps the toolbar inside the editor panel', () => {
        const placement = computePinnedAbsolutePlacement({
            ...base,
            tableRect: rect({ top: 350, bottom: 900, left: 5000 }),
            pinAbove: true,
        });

        expect(placement.x).toBe(600 - 200 - TOOLBAR_VIEWPORT_PADDING_PX);
    });

    it('falls back to the padding when the panel is narrower than the toolbar', () => {
        const placement = computePinnedAbsolutePlacement({
            ...base,
            viewRect: rect({ top: 100, left: 50, width: 100, height: 400 }),
            tableRect: rect({ top: 350, bottom: 900, left: 5000 }),
            pinAbove: true,
        });

        expect(placement.x).toBe(TOOLBAR_VIEWPORT_PADDING_PX);
    });

    it('never pins above the viewport top when the bottom edge would be higher', () => {
        const placement = computePinnedAbsolutePlacement({
            ...base,
            viewport: { top: 100, bottom: 110, height: 10 },
            tableRect: rect({ top: -400, bottom: 105, left: 120 }),
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

    it('uses viewport-relative coordinates when pinning above', () => {
        const placement = computePinnedFixedPlacement({
            ...base,
            tableRect: rect({ top: 500, bottom: 1200, left: 30 }),
            pinAbove: true,
        });

        expect(placement).toEqual({ x: 30, y: 5, strategy: 'fixed' });
    });

    it('uses viewport-relative coordinates when pinning below', () => {
        const placement = computePinnedFixedPlacement({
            ...base,
            tableRect: rect({ top: -500, bottom: 300, left: 30 }),
            pinAbove: false,
        });

        expect(placement).toEqual({ x: 30, y: 765, strategy: 'fixed' });
    });

    it('clamps the toolbar inside the viewport width', () => {
        const placement = computePinnedFixedPlacement({
            ...base,
            tableRect: rect({ top: 500, bottom: 1200, left: 380 }),
            pinAbove: true,
        });

        expect(placement.x).toBe(400 - 200 - TOOLBAR_VIEWPORT_PADDING_PX);
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
        expect(isObscuringTopPlacement('top-start', 2)).toBe(true);
    });

    it('ignores a top placement with clearance', () => {
        expect(isObscuringTopPlacement('top-start', 40)).toBe(false);
    });

    it('ignores bottom placements', () => {
        expect(isObscuringTopPlacement('bottom-start', 0)).toBe(false);
    });
});

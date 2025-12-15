import { computeToolbarPosition } from '../toolbar/toolbarPositioning';

describe('computeToolbarPosition', () => {
    const parentRect = { top: 0, bottom: 800, left: 0, right: 800 };
    const viewportRect = { top: 0, bottom: 600, left: 0, right: 800 };
    const toolbar = { height: 40, width: 200 };
    const margin = 5;

    it('hides toolbar when table is completely out of view', () => {
        const tableRect = { top: -200, bottom: -50, left: 10, right: 500 };

        const result = computeToolbarPosition({ tableRect, viewportRect, parentRect, toolbar, margin });

        expect(result.visible).toBe(false);
    });

    it('anchors above the table when there is room', () => {
        const tableRect = { top: 200, bottom: 400, left: 10, right: 500 };

        const result = computeToolbarPosition({ tableRect, viewportRect, parentRect, toolbar, margin });

        expect(result.visible).toBe(true);
        expect(result.anchor).toBe('top');
        expect(result.top).toBe(200 - toolbar.height - margin);
        expect(result.left).toBe(10);
    });

    it('anchors below the table when there is not enough room above', () => {
        const tableRect = { top: 10, bottom: 120, left: 10, right: 500 };

        const result = computeToolbarPosition({ tableRect, viewportRect, parentRect, toolbar, margin });

        expect(result.visible).toBe(true);
        expect(result.anchor).toBe('bottom');
        expect(result.top).toBe(120 + margin);
    });

    it('uses bottom anchor when only the bottom edge is visible', () => {
        const tableRect = { top: -200, bottom: 200, left: 10, right: 500 };

        const result = computeToolbarPosition({ tableRect, viewportRect, parentRect, toolbar, margin });

        expect(result.visible).toBe(true);
        expect(result.anchor).toBe('bottom');
        expect(result.top).toBe(200 + margin);
    });

    it('keeps toolbar visible (clamped) for very tall tables spanning the viewport', () => {
        const tableRect = { top: -100, bottom: 900, left: 10, right: 500 };

        const result = computeToolbarPosition({ tableRect, viewportRect, parentRect, toolbar, margin });

        expect(result.visible).toBe(true);
        expect(result.anchor).toBe('top');
        expect(result.top).toBe(margin);
    });
});

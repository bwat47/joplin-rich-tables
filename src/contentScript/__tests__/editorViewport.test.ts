import { describe, expect, it } from 'vitest';
import { getViewportHeight, getViewportWidth, resolveViewportBounds } from '../shared/editorViewport';

describe('resolveViewportBounds', () => {
    it('keeps the scroller rect when the editor scrolls internally', () => {
        // Desktop pins the editor to a fixed-height container, so the scroller already sits
        // inside the window and the intersection leaves it untouched.
        const bounds = resolveViewportBounds({ top: 40, bottom: 640 }, 1000);

        expect(bounds).toEqual({ top: 40, bottom: 640, height: 600 });
    });

    it('falls back to the window when the scroller spans the whole document', () => {
        // Mobile and web leave the editor's height unconstrained, so the scroller runs past
        // both window edges and the window is the only limit left.
        const bounds = resolveViewportBounds({ top: -200, bottom: 1400 }, 800);

        expect(bounds).toEqual({ top: 0, bottom: 800, height: 800 });
    });

    it('clips to whichever edge is tighter on each side', () => {
        const bounds = resolveViewportBounds({ top: -50, bottom: 300 }, 800);

        expect(bounds).toEqual({ top: 0, bottom: 300, height: 300 });
    });

    it('reports a non-positive height once the scroller leaves the window', () => {
        const bounds = resolveViewportBounds({ top: 900, bottom: 1200 }, 800);

        expect(bounds.bottom).toBeLessThanOrEqual(bounds.top);
    });
});

describe('getViewportHeight', () => {
    it('prefers the visual viewport, which shrinks with an on-screen keyboard', () => {
        expect(getViewportHeight({ visualViewport: { height: 420 }, innerHeight: 800 } as Window)).toBe(420);
    });

    it('falls back to the window where no visual viewport is exposed', () => {
        expect(getViewportHeight({ innerHeight: 800 } as Window)).toBe(800);
    });
});

describe('getViewportWidth', () => {
    it('prefers the visual viewport', () => {
        expect(getViewportWidth({ visualViewport: { width: 320 }, innerWidth: 600 } as Window)).toBe(320);
    });

    it('falls back to the window where no visual viewport is exposed', () => {
        expect(getViewportWidth({ innerWidth: 600 } as Window)).toBe(600);
    });
});

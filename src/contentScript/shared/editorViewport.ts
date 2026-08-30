/** Vertical bounds of the band the reader can actually see, in client coordinates. */
export interface ViewportBounds {
    top: number;
    bottom: number;
    height: number;
}

/** Height of the area the editor's window shows, allowing for a shrunken visual viewport. */
export function getViewportHeight(viewWindow: Window): number {
    return viewWindow.visualViewport?.height ?? viewWindow.innerHeight;
}

/** Width of the area the editor's window shows, allowing for a shrunken visual viewport. */
export function getViewportWidth(viewWindow: Window): number {
    return viewWindow.visualViewport?.width ?? viewWindow.innerWidth;
}

/**
 * Intersects the editor's scroller with the window to leave the visible band.
 *
 * CodeMirror scrolls internally only where something constrains its height, as the desktop app
 * does by pinning the editor to a fixed-height container. Where nothing does — Joplin mobile and
 * web, whose editor document has no height constraint at all — `scrollDOM` grows to the whole
 * document and the window is the only limit. Intersecting covers both: a scroller that already
 * sits inside the window survives the intersection unchanged.
 */
export function resolveViewportBounds(
    scrollRect: { top: number; bottom: number },
    viewportHeight: number
): ViewportBounds {
    const top = Math.max(scrollRect.top, 0);
    const bottom = Math.min(scrollRect.bottom, viewportHeight);

    return { top, bottom, height: bottom - top };
}

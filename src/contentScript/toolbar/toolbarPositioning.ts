export interface RectLike {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

export type ToolbarAnchor = 'top' | 'bottom';

export interface ToolbarSize {
    height: number;
    width?: number;
}

export interface ToolbarPositionResult {
    visible: boolean;
    top: number;
    left: number;
    anchor: ToolbarAnchor;
}

function rectsVerticallyIntersect(a: RectLike, b: RectLike): boolean {
    return a.bottom > b.top && a.top < b.bottom;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/**
 * Computes the toolbar position relative to `parentRect`.
 *
 * Rules:
 * - Toolbar is hidden if the table is completely out of view.
 * - Prefer anchoring above the table if it fits in the viewport.
 * - Otherwise anchor below the table if it fits.
 * - If the table is partially visible but neither anchored position fits (e.g. very tall tables),
 *   keep the toolbar within the viewport by clamping to the top/bottom edge.
 */
export function computeToolbarPosition(params: {
    tableRect: RectLike;
    viewportRect: RectLike;
    parentRect: RectLike;
    toolbar: ToolbarSize;
    margin: number;
}): ToolbarPositionResult {
    const { tableRect, viewportRect, parentRect, toolbar, margin } = params;

    const toolbarHeight = Math.max(0, toolbar.height);

    if (!rectsVerticallyIntersect(tableRect, viewportRect)) {
        return {
            visible: false,
            top: 0,
            left: 0,
            anchor: 'top',
        };
    }

    const viewportTop = viewportRect.top - parentRect.top;
    const viewportBottom = viewportRect.bottom - parentRect.top;

    const tableTop = tableRect.top - parentRect.top;
    const tableBottom = tableRect.bottom - parentRect.top;

    const aboveTop = tableTop - toolbarHeight - margin;
    const belowTop = tableBottom + margin;

    const fitsAbove = aboveTop >= viewportTop && aboveTop + toolbarHeight <= viewportBottom;
    const fitsBelow = belowTop >= viewportTop && belowTop + toolbarHeight <= viewportBottom;

    let anchor: ToolbarAnchor;
    let top: number;

    if (fitsAbove) {
        anchor = 'top';
        top = aboveTop;
    } else if (fitsBelow) {
        anchor = 'bottom';
        top = belowTop;
    } else {
        // Table is visible, but anchored positions don't fit.
        // Keep the toolbar visible by pinning it to the viewport edge that corresponds
        // to the off-screen side of the table.
        if (tableRect.top < viewportRect.top) {
            anchor = 'top';
            top = viewportTop + margin;
        } else {
            anchor = 'bottom';
            top = viewportBottom - toolbarHeight - margin;
        }

        // Defensive clamp (avoids negative heights or weird rects).
        top = clamp(top, viewportTop + margin, viewportBottom - toolbarHeight - margin);
    }

    const left = tableRect.left - parentRect.left;

    return {
        visible: true,
        top,
        left,
        anchor,
    };
}

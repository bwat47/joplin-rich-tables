import { buildRenderableContent, containsMarkdown, escapeHtmlPreservingBr } from '../shared/cellContentUtils';
import type { MarkdownRenderService } from './markdownRenderer';
import { logger } from '../../logger';

/**
 * Renders a cell's markdown into an existing element.
 *
 * Shared by the table widget (which renders into a freshly created content wrapper) and the
 * nested editor controller (which renders back into the wrapper it took over on activation),
 * so both paths stay identical: cached HTML is written synchronously, and a cache miss shows
 * escaped text first and swaps in the rendered HTML when it arrives.
 *
 * The caller owns the target element; this function only writes its content.
 */
export function renderCellMarkdownInto(target: HTMLElement, markdown: string, renderer: MarkdownRenderService): void {
    const { displayText, cacheKey } = buildRenderableContent(markdown);

    // Check if we have cached rendered HTML for the normalized cell content
    const cached = renderer.getCached(cacheKey);
    if (cached !== undefined) {
        target.innerHTML = cached;
        return;
    }

    // Show content with <br> rendered as line breaks while async render runs
    target.innerHTML = escapeHtmlPreservingBr(displayText);

    // Check if content likely contains markdown (optimization)
    if (!containsMarkdown(cacheKey)) {
        return;
    }

    // Request async rendering and update when ready
    void renderer
        .render(cacheKey)
        .then((html) => {
            // Only update if the target is still in the DOM.
            // Note: Height re-measurement is handled automatically by ResizeObserver.
            if (target.isConnected) {
                target.innerHTML = html;
            }
        })
        .catch((error) => {
            logger.error('Failed to render cell markdown:', error);
        });
}

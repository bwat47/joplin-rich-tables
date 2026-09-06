import { buildRenderableContent, mightContainMarkup } from '../shared/cellContentUtils';
import { replaceContent, textFragmentPreservingBr } from './domFragment';
import type { MarkdownRenderService } from './markdownRenderer';
import { logger } from '../../logger';

/**
 * Renders a cell's markdown into an existing element.
 *
 * Shared by the table widget (which renders into a freshly created content wrapper) and the
 * nested editor controller (which renders back into the wrapper it took over on activation),
 * so both paths stay identical: cached content is written synchronously, and a cache miss shows
 * plain text first and swaps in the rendered content when it arrives.
 *
 * The caller owns the target element; this function only writes its content.
 */
export function renderCellMarkdownInto(target: HTMLElement, markdown: string, renderer: MarkdownRenderService): void {
    const { displayText, cacheKey } = buildRenderableContent(markdown);

    // Check if we have cached rendered content for the normalized cell content
    const cached = renderer.getCached(cacheKey);
    if (cached !== undefined) {
        replaceContent(target, cached);
        return;
    }

    // Show content with <br> rendered as line breaks while async render runs
    replaceContent(target, textFragmentPreservingBr(displayText, target.ownerDocument));

    // Plain text can't be transformed by the renderer, so skip the round-trip (optimization)
    if (!mightContainMarkup(cacheKey)) {
        return;
    }

    // Request async rendering and update when ready
    void renderer
        .render(cacheKey)
        .then((fragment) => {
            // Only update if the target is still in the DOM.
            // Note: Height re-measurement is handled automatically by ResizeObserver.
            if (target.isConnected) {
                replaceContent(target, fragment);
            }
        })
        .catch((error) => {
            logger.error('Failed to render cell markdown:', error);
        });
}

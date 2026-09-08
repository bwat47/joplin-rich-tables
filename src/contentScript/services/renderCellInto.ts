import { buildRenderableContent, containsMarkdown } from '../shared/cellContentUtils';
import { replaceContent, textFragmentPreservingBr } from './domFragment';
import type { MarkdownRenderService } from './markdownRenderer';
import { logger } from '../../logger';

/**
 * The newest render request each target has seen.
 *
 * A target outlives any single request and is written by more than one caller: the table widget
 * renders into a cell's content wrapper, and the nested editor renders into that same wrapper when
 * it closes. Without this, a slow earlier render resolves last and paints stale content over the
 * newer result.
 */
const renderGeneration = new WeakMap<HTMLElement, number>();

/** Claims the target for a new request, invalidating any render still in flight for it. */
function claimGeneration(target: HTMLElement): number {
    const generation = (renderGeneration.get(target) ?? 0) + 1;
    renderGeneration.set(target, generation);
    return generation;
}

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
    // Claimed for every call, including the synchronous ones below: they write the target too,
    // so an older pending render must not outlive them either.
    const generation = claimGeneration(target);

    // Check if we have cached rendered content for the normalized cell content
    const cached = renderer.getCached(cacheKey);
    if (cached !== undefined) {
        replaceContent(target, cached);
        return;
    }

    // Show content with <br> rendered as line breaks while async render runs
    replaceContent(target, textFragmentPreservingBr(displayText, target.ownerDocument));

    // Check if content likely contains markdown (optimization)
    if (!containsMarkdown(cacheKey)) {
        return;
    }

    // Request async rendering and update when ready
    void renderer
        .render(cacheKey)
        .then((fragment) => {
            // Only update if this is still the target's latest request and it is in the DOM.
            // Note: Height re-measurement is handled automatically by ResizeObserver.
            if (renderGeneration.get(target) === generation && target.isConnected) {
                replaceContent(target, fragment);
            }
        })
        .catch((error) => {
            logger.error('Failed to render cell markdown:', error);
        });
}

import { logger } from '../../logger';
import DOMPurify from 'dompurify';

/**
 * Markdown rendering service that communicates with the main plugin
 * to render markdown content using Joplin's renderMarkup command.
 */

type PostMessageFn = (message: unknown) => Promise<unknown>;

interface RenderResult {
    id: string;
    html: string;
    error?: boolean;
}

/**
 * Interface for markdown rendering service.
 * Allows decoupling widgets/editors from the specific caching/rendering implementation.
 */
export interface MarkdownRenderService {
    renderAsync(text: string, callback: (html: string) => void): void;
    getCached(text: string): string | undefined;
    clear(): void;
}

// Cache for rendered markdown to avoid redundant rendering.
// Limited to MAX_CACHE_SIZE entries with FIFO eviction to prevent unbounded memory growth.
const MAX_CACHE_SIZE = 500;
const renderCache = new Map<string, string>();

function setCacheEntry(key: string, value: string): void {
    if (renderCache.size >= MAX_CACHE_SIZE) {
        // Delete oldest entry (Map maintains insertion order)
        const firstKey = renderCache.keys().next().value;
        if (firstKey !== undefined) {
            renderCache.delete(firstKey);
        }
    }
    renderCache.set(key, value);
}

// Pending render requests to avoid duplicate requests
const pendingRequests = new Map<string, Promise<string>>();

let postMessageFn: PostMessageFn | null = null;
let requestIdCounter = 0;

/**
 * Initialize the renderer with the postMessage function from content script context
 */
export function initRenderer(postMessage: PostMessageFn): void {
    postMessageFn = postMessage;
}

/**
 * Configure DOMPurify hooks once globally to avoid re-adding them on every render.
 */
DOMPurify.addHook('afterSanitizeElements', (node) => {
    // Remove <span class="resource-icon ..."> used by Joplin for resource icons,
    // which don't render correctly in this context.
    if (node instanceof Element && node.tagName === 'SPAN' && node.classList.contains('resource-icon')) {
        node.remove();
    }
});

/**
 * Sanitize HTML rendered by Joplin to ensure security and fix display issues.
 * - Allows specific attributes needed for internal links/images
 * - Allows unknown protocols for joplin-content://
 * - Removes "resource-icon" spans via hook
 * - Relies on DOMPurify's safe defaults to block dangerous tags/attributes
 */
function sanitizeHtml(html: string): string {
    let sanitized = DOMPurify.sanitize(html, {
        ALLOW_UNKNOWN_PROTOCOLS: true,
        ADD_ATTR: ['data-resource-id', 'data-note-id', 'data-item-id', 'data-from-md'],
    });

    // Post-process: Convert literal [^label] patterns into footnote links.
    // Markdown-it-footnote auto-numbers by first appearance, which breaks when
    // rendering cells independently. Instead, we skip injection and manually
    // convert any remaining [^label] text into styled superscript links.
    sanitized = sanitized.replace(/\[\^([^\]]+)\]/g, '<sup class="footnote-ref"><a href="#fn-$1">$1</a></sup>');

    return sanitized;
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
    return `render-${++requestIdCounter}-${Date.now()}`;
}

/**
 * Render markdown to HTML asynchronously
 * Returns cached result if available, otherwise sends request to main plugin
 */
async function renderMarkdown(markdown: string): Promise<string> {
    // Return cached result if available
    const cached = renderCache.get(markdown);
    if (cached !== undefined) {
        return cached;
    }

    // Return pending request if one exists for this markdown
    const pending = pendingRequests.get(markdown);
    if (pending) {
        return pending;
    }

    if (!postMessageFn) {
        logger.warn('Renderer not initialized, returning raw markdown');
        return markdown;
    }

    // Create new render request
    const id = generateRequestId();
    const promise = (async () => {
        try {
            const result = (await postMessageFn({
                type: 'renderMarkup',
                markdown,
                id,
            })) as RenderResult | null;

            if (result && result.html) {
                const html = sanitizeHtml(result.html);
                setCacheEntry(markdown, html);
                return html;
            }

            // Fallback to raw markdown if rendering failed
            return markdown;
        } catch (error) {
            logger.error('Failed to render markdown:', error);
            return markdown;
        } finally {
            pendingRequests.delete(markdown);
        }
    })();

    pendingRequests.set(markdown, promise);
    return promise;
}

/**
 * Clear the render cache (useful when document changes significantly)
 */
export function clearRenderCache(): void {
    renderCache.clear();
}

/**
 * Check if markdown content is cached
 */
export function isCached(markdown: string): boolean {
    return renderCache.has(markdown);
}

/**
 * Default renderer implementation using internal cache and postMessage.
 */
class DefaultMarkdownRenderer implements MarkdownRenderService {
    renderAsync(text: string, callback: (html: string) => void): void {
        const cached = renderCache.get(text);
        if (cached !== undefined) {
            callback(cached);
            return;
        }
        renderMarkdown(text).then(callback);
    }

    getCached(text: string): string | undefined {
        return renderCache.get(text);
    }

    clear(): void {
        renderCache.clear();
    }
}

export const renderer: MarkdownRenderService = new DefaultMarkdownRenderer();

/**
 * Open a link using Joplin's openItem command
 * Handles both internal Joplin links and external URLs
 */
export function openLink(href: string): void {
    if (!postMessageFn) {
        logger.warn('Renderer not initialized, cannot open link');
        return;
    }

    postMessageFn({
        type: 'openLink',
        href,
    }).catch((error) => {
        logger.error('Failed to open link:', error);
    });
}

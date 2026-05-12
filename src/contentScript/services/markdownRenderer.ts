import { Facet } from '@codemirror/state';
import { logger } from '../../logger';
import type { RenderMarkupResult } from '../../contentScriptBridge/contentScriptMessages';
import { escapeHtmlPreservingBr } from '../shared/cellContentUtils';
import { sanitizeHtml } from './htmlSanitizer';
import { postProcessHtml } from './htmlPostProcessor';

/**
 * Markdown rendering service that communicates with the main plugin
 * to render markdown content using Joplin's renderMarkup command.
 */

export type RenderMarkupFn = (markdown: string, id: string) => Promise<RenderMarkupResult | null>;

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

/**
 * Default renderer used only when the extension wiring has not installed a real service.
 * It returns escaped fallback HTML so callers can safely assign the result to innerHTML.
 */
const fallbackMarkdownRenderer: MarkdownRenderService = {
    renderAsync(text, callback) {
        logger.warn('Markdown renderer service missing, returning escaped markdown');
        callback(escapeHtmlPreservingBr(text));
    },
    getCached() {
        return undefined;
    },
    clear() {
        // No-op fallback.
    },
};

/**
 * Facet that exposes the extension-owned markdown renderer to widgets and runtime code.
 */
export const markdownRenderServiceFacet = Facet.define<MarkdownRenderService, MarkdownRenderService>({
    combine: (values) => values[0] ?? fallbackMarkdownRenderer,
});

/**
 * Default renderer implementation using instance-local cache and render transport.
 */
class DefaultMarkdownRenderer implements MarkdownRenderService {
    private readonly renderCache = new Map<string, string>();
    private readonly pendingRequests = new Map<string, { promise?: Promise<string> }>();
    private requestIdCounter = 0;
    private generation = 0;

    constructor(private readonly renderMarkup: RenderMarkupFn) {}

    renderAsync(text: string, callback: (html: string) => void): void {
        const cached = this.renderCache.get(text);
        if (cached !== undefined) {
            callback(cached);
            return;
        }
        this.renderMarkdown(text).then(callback);
    }

    getCached(text: string): string | undefined {
        return this.renderCache.get(text);
    }

    clear(): void {
        // In-flight requests still resolve for existing callbacks, but their results are not cached.
        this.renderCache.clear();
        this.pendingRequests.clear();
        this.generation++;
    }

    private setCacheEntry(key: string, value: string): void {
        if (this.renderCache.size >= MAX_CACHE_SIZE) {
            // Delete oldest entry (Map maintains insertion order)
            const firstKey = this.renderCache.keys().next().value;
            if (firstKey !== undefined) {
                this.renderCache.delete(firstKey);
            }
        }
        this.renderCache.set(key, value);
    }

    /**
     * Generate a unique request ID.
     */
    private generateRequestId(): string {
        return `render-${++this.requestIdCounter}-${Date.now()}`;
    }

    /**
     * Render markdown to HTML asynchronously.
     * Returns cached result if available, otherwise sends request to main plugin.
     */
    private async renderMarkdown(markdown: string): Promise<string> {
        const cached = this.renderCache.get(markdown);
        if (cached !== undefined) {
            return cached;
        }

        const pending = this.pendingRequests.get(markdown);
        if (pending?.promise) {
            return pending.promise;
        }

        const id = this.generateRequestId();
        const generation = this.generation;
        const pendingRequest: { promise?: Promise<string> } = {};
        const promise = (async () => {
            try {
                const result = await this.renderMarkup(markdown, id);

                if (result && !result.error && typeof result.html === 'string') {
                    // Clean pipeline: sanitize -> post-process
                    const html = postProcessHtml(sanitizeHtml(result.html));
                    if (this.generation === generation && this.pendingRequests.get(markdown) === pendingRequest) {
                        this.setCacheEntry(markdown, html);
                    }
                    return html;
                }

                return escapeHtmlPreservingBr(markdown);
            } catch (error) {
                logger.error('Failed to render markdown:', error);
                return escapeHtmlPreservingBr(markdown);
            } finally {
                if (this.pendingRequests.get(markdown) === pendingRequest) {
                    this.pendingRequests.delete(markdown);
                }
            }
        })();

        pendingRequest.promise = promise;
        this.pendingRequests.set(markdown, pendingRequest);
        return promise;
    }
}

export function createMarkdownRenderer(renderMarkup: RenderMarkupFn): MarkdownRenderService {
    return new DefaultMarkdownRenderer(renderMarkup);
}

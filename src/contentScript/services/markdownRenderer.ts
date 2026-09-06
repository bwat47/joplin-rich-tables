import { Facet } from '@codemirror/state';
import { logger } from '../../logger';
import type { RenderMarkupResult } from '../../contentScriptBridge/contentScriptMessages';
import { textFragmentPreservingBr } from './domFragment';
import { sanitizeToFragment } from './htmlSanitizer';
import { postProcessFragment } from './htmlPostProcessor';

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
    /**
     * Both accessors hand back a fresh copy: the cached fragment is never inserted anywhere, so
     * appending one caller's result cannot empty another cell's content.
     */
    render(text: string): Promise<DocumentFragment>;
    getCached(text: string): DocumentFragment | undefined;
    clear(): void;
}

// Cache for rendered markdown to avoid redundant rendering.
// Limited to MAX_CACHE_SIZE entries with LRU eviction to prevent unbounded memory growth.
export const MAX_CACHE_SIZE = 500;

/**
 * Default renderer used only when the extension wiring has not installed a real service.
 * It returns the markdown as literal text, so callers get something displayable without the
 * markup being interpreted.
 */
const fallbackMarkdownRenderer: MarkdownRenderService = {
    render(text) {
        logger.warn('Markdown renderer service missing, returning unrendered markdown');
        return Promise.resolve(textFragmentPreservingBr(text));
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
    /** Canonical fragments, never handed out directly. `cloneNode` copies are what callers get. */
    private readonly renderCache = new Map<string, DocumentFragment>();
    private readonly pendingRequests = new Map<string, { promise?: Promise<DocumentFragment> }>();
    private requestIdCounter = 0;
    private generation = 0;

    constructor(private readonly renderMarkup: RenderMarkupFn) {}

    getCached(text: string): DocumentFragment | undefined {
        const cached = this.renderCache.get(text);
        if (cached === undefined) {
            return undefined;
        }

        // Re-insert so eviction follows use rather than insertion. Scrolling back through a
        // document revisits the cells viewed most recently, which are the ones insertion order
        // evicts first.
        this.renderCache.delete(text);
        this.renderCache.set(text, cached);
        return cloneFragment(cached);
    }

    clear(): void {
        // In-flight requests still resolve for existing callers, but their results are not cached.
        this.renderCache.clear();
        this.pendingRequests.clear();
        this.generation++;
    }

    private setCacheEntry(key: string, value: DocumentFragment): void {
        if (this.renderCache.size >= MAX_CACHE_SIZE) {
            // Delete the least recently used entry (Map maintains insertion order, and
            // getCached() re-inserts on a hit)
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
     * Render markdown asynchronously.
     * Returns cached content if available, otherwise sends a request to the main plugin.
     */
    async render(markdown: string): Promise<DocumentFragment> {
        const cached = this.getCached(markdown);
        if (cached !== undefined) {
            return cached;
        }

        // Concurrent callers share the request but not its result, so each takes its own copy of
        // the fragment the request resolves to.
        return cloneFragment(await this.renderCanonical(markdown));
    }

    /** The shared, never-inserted fragment for a payload: the cache entry, or the pending one. */
    private renderCanonical(markdown: string): Promise<DocumentFragment> {
        const pending = this.pendingRequests.get(markdown);
        if (pending?.promise) {
            return pending.promise;
        }

        const id = this.generateRequestId();
        const generation = this.generation;
        const pendingRequest: { promise?: Promise<DocumentFragment> } = {};
        const promise = (async () => {
            try {
                const result = await this.renderMarkup(markdown, id);

                if (result && !result.error && typeof result.html === 'string') {
                    // Clean pipeline: sanitize -> post-process
                    const fragment = sanitizeToFragment(result.html);
                    postProcessFragment(fragment);
                    if (this.generation === generation && this.pendingRequests.get(markdown) === pendingRequest) {
                        this.setCacheEntry(markdown, fragment);
                    }
                    return fragment;
                }

                return textFragmentPreservingBr(markdown);
            } catch (error) {
                logger.error('Failed to render markdown:', error);
                return textFragmentPreservingBr(markdown);
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

/** Copies a cached fragment so the caller owns nodes it can append without emptying the cache. */
function cloneFragment(fragment: DocumentFragment): DocumentFragment {
    return fragment.cloneNode(true) as DocumentFragment;
}

export function createMarkdownRenderer(renderMarkup: RenderMarkupFn): MarkdownRenderService {
    return new DefaultMarkdownRenderer(renderMarkup);
}

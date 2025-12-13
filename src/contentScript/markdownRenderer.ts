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

// Cache for rendered markdown to avoid redundant rendering
const renderCache = new Map<string, string>();

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
 * Generate a unique request ID
 */
function generateRequestId(): string {
    return `render-${++requestIdCounter}-${Date.now()}`;
}

/**
 * Render markdown to HTML asynchronously
 * Returns cached result if available, otherwise sends request to main plugin
 */
export async function renderMarkdown(markdown: string): Promise<string> {
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
        console.warn('[RichTables] Renderer not initialized, returning raw markdown');
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
                const html = result.html;
                renderCache.set(markdown, html);
                return html;
            }

            // Fallback to raw markdown if rendering failed
            return markdown;
        } catch (error) {
            console.error('[RichTables] Failed to render markdown:', error);
            return markdown;
        } finally {
            pendingRequests.delete(markdown);
        }
    })();

    pendingRequests.set(markdown, promise);
    return promise;
}

/**
 * Render markdown and call callback when done (for use in widget toDOM)
 * This is useful when you can't await in synchronous code
 */
export function renderMarkdownAsync(
    markdown: string,
    callback: (html: string) => void
): void {
    const cached = renderCache.get(markdown);
    if (cached !== undefined) {
        callback(cached);
        return;
    }

    renderMarkdown(markdown).then(callback);
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
 * Get cached HTML for markdown (returns undefined if not cached)
 */
export function getCached(markdown: string): string | undefined {
    return renderCache.get(markdown);
}

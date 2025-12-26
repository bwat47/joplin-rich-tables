/**
 * Unescapes pipe characters for rendering.
 * In GFM tables, pipes must be escaped (\|) to avoid being treated as cell delimiters.
 * When rendering cell content as standalone markdown, the escaping is no longer needed.
 */
export function unescapePipesForRendering(text: string): string {
    return text.replace(/\\(\|)/g, '$1');
}

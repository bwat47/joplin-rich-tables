/**
 * Unescapes pipe characters for rendering.
 * In GFM tables, pipes must be escaped (\|) to avoid being treated as cell delimiters.
 * When rendering cell content as standalone markdown, the escaping is no longer needed.
 */
export function unescapePipesForRendering(text: string): string {
    return text.replace(/\\(\|)/g, '$1');
}

export interface RenderableContent {
    /** Unescaped cell text for raw display (fallback while rendering) */
    displayText: string;
    /** Content with definitions appended, used for rendering and cache key */
    cacheKey: string;
}

/**
 * Builds the content strings used for rendering and cache lookup.
 * Unescapes pipes and appends the definition block for reference link support.
 * Empty cells return empty string for both (no definition block appended).
 */
export function buildRenderableContent(cellText: string, definitionBlock: string): RenderableContent {
    const displayText = unescapePipesForRendering(cellText);
    const cacheKey =
        displayText && definitionBlock ? `${displayText}\n\n${definitionBlock}` : displayText;
    return { displayText, cacheKey };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const uslug = require('@joplin/fork-uslug');

/**
 * Generate a slug for a heading text, matching Joplin's behavior.
 */
export function slugify(text: string): string {
    return uslug(text);
}

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
 * Check if text looks like a reference link definition.
 * Pattern: [label]: URL (with optional title)
 */
function looksLikeDefinition(text: string): boolean {
    return /^\s*\[[^\]]+\]:\s*\S/.test(text);
}

/**
 * Builds the content strings used for rendering and cache lookup.
 * Unescapes pipes and appends the definition block for reference link support.
 * Empty cells return empty string for both (no definition block appended).
 *
 * Definition block is NOT appended if:
 * - The cell content itself looks like a reference definition (causes rendering issues)
 * - The cell content has no brackets (can't contain reference links, improves cache stability)
 */
export function buildRenderableContent(cellText: string, definitionBlock: string): RenderableContent {
    const displayText = unescapePipesForRendering(cellText);
    const hasLinkSyntax = displayText.includes('[');
    const shouldAppendDefinitions =
        hasLinkSyntax && displayText && definitionBlock && !looksLikeDefinition(displayText);
    const cacheKey = shouldAppendDefinitions ? `${displayText}\n\n${definitionBlock}` : displayText;

    return { displayText, cacheKey };
}

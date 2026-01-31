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

/**
 * Escape leading block markers so cells render inline-only markdown.
 * Assumes cell content has no newlines.
 */
export function escapeLeadingBlockMarkers(text: string): string {
    if (!text) return text;

    const match = text.match(/^(\s{0,3})(.*)$/);
    if (!match) return text;

    const leading = match[1];
    const rest = match[2];
    if (!rest) return text;

    // Avoid touching inline code that starts the cell.
    if (rest.startsWith('`')) {
        return text;
    }

    // Headings: "# " / "## " ...
    if (/^#{1,6}(\s|$)/.test(rest)) {
        return `${leading}\\${rest}`;
    }

    // Blockquote: "> " (space optional)
    if (/^>/.test(rest)) {
        return `${leading}\\${rest}`;
    }

    // Unordered list: "- " / "* " / "+ "
    if (/^[-*+](\s|$)/.test(rest)) {
        return `${leading}\\${rest}`;
    }

    // Ordered list: "1. " / "1) "
    const orderedMatch = rest.match(/^(\d+)([.)])(\s|$)/);
    if (orderedMatch) {
        const [, number, marker] = orderedMatch;
        return `${leading}${number}\\${marker}${rest.slice(number.length + 1)}`;
    }

    return text;
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
    const displayText = escapeLeadingBlockMarkers(unescapePipesForRendering(cellText));
    const hasLinkSyntax = displayText.includes('[');
    const shouldAppendDefinitions =
        hasLinkSyntax && displayText && definitionBlock && !looksLikeDefinition(displayText);
    const cacheKey = shouldAppendDefinitions ? `${displayText}\n\n${definitionBlock}` : displayText;

    return { displayText, cacheKey };
}

/**
 * Quick check if content likely contains markdown formatting
 * Avoids unnecessary render requests for plain text
 */
export function containsMarkdown(text: string): boolean {
    // Common markdown patterns
    return (
        text.includes('**') || // bold
        text.includes('__') || // bold
        text.includes('*') || // italic (single asterisk)
        text.includes('_') || // italic (single underscore)
        text.includes('`') || // code
        text.includes('[') || // links
        text.includes('~~') || // strikethrough
        text.includes('![') || // images
        text.includes('<') || // HTML tags
        text.includes('==') || // Highlights
        text.includes('++') || // Insert (++)
        text.includes('\\') || // Escaped Text
        text.includes('mailto:') || // Mailto links
        text.includes('http') || // bare links
        text.includes('#') // Headings
    );
}

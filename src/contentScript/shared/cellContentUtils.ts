import uslug from '@joplin/fork-uslug';

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
function unescapePipesForRendering(text: string): string {
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
    /** Normalized content used for rendering and cache lookup */
    cacheKey: string;
}

/**
 * Builds the content strings used for rendering and cache lookup.
 * Unescapes pipes for display, then escapes leading block markers for isolated cell rendering.
 */
export function buildRenderableContent(cellText: string): RenderableContent {
    const displayText = unescapePipesForRendering(cellText);
    const cacheKey = escapeLeadingBlockMarkers(displayText);

    return { displayText, cacheKey };
}

/**
 * Escapes HTML entities but preserves <br> tags as actual line breaks.
 * Used as a fallback when the render cache misses, so that multi-line
 * content doesn't flash raw <br> text while the async renderer runs.
 */
export function escapeHtmlPreservingBr(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/&lt;br&gt;/g, '<br>');
}

/**
 * Quick check if content likely contains markdown formatting
 * Avoids unnecessary render requests for plain text
 */
export function containsMarkdown(text: string): boolean {
    const hasMathDelimiterPair = text.includes('$') && text.indexOf('$') !== text.lastIndexOf('$');

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
        hasMathDelimiterPair // KaTeX inline/display math delimiters ($...$ / $$...$$)
    );
}

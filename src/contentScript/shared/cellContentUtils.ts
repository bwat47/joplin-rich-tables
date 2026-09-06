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
 * Block markers escaped by prefixing a backslash to the whole run.
 * Ordered lists are handled separately: their backslash goes after the number ("1\. ").
 */
const LEADING_BLOCK_MARKERS = [
    /^#{1,6}(\s|$)/, // headings: "# " / "## " ...
    /^>/, // blockquote: "> " (space optional)
    /^[-*+](\s|$)/, // unordered list: "- " / "* " / "+ "
];

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

    if (LEADING_BLOCK_MARKERS.some((pattern) => pattern.test(rest))) {
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
 * Substrings that suggest inline markdown formatting.
 * Checked as an order-independent disjunction, so each entry must not be
 * subsumed by a shorter one (e.g. '**' would be dead next to '*').
 */
const MARKDOWN_MARKERS = [
    '*', // bold / italic
    '_', // bold / italic
    '`', // code
    '[', // links and images
    '~', // strikethrough / subscript
    '^', // superscript
    '<', // HTML tags
    '==', // highlights
    '++', // insert
    '\\', // escaped text
    'mailto:', // mailto links
    'http', // bare links
] as const;

/** HTML named/numeric entities and Joplin emoji shortcodes (for example, `&amp;` and `:smile:`). */
const HTML_ENTITY_PATTERN = /&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i;
const EMOJI_SHORTCODE_PATTERN = /:[a-z\d_+-]+:/i;

/**
 * Quick check if content likely contains markdown formatting
 * Avoids unnecessary render requests for plain text
 */
export function containsMarkdown(text: string): boolean {
    // KaTeX needs a delimiter pair ($...$ / $$...$$), so a lone '$' shouldn't trigger a render.
    const hasMathDelimiterPair = text.includes('$') && text.indexOf('$') !== text.lastIndexOf('$');

    return (
        MARKDOWN_MARKERS.some((marker) => text.includes(marker)) ||
        hasMathDelimiterPair ||
        HTML_ENTITY_PATTERN.test(text) ||
        EMOJI_SHORTCODE_PATTERN.test(text)
    );
}

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
 * Characters that cannot activate markup on their own.
 *
 * This is an allowlist by design: Joplin's renderer is a configurable stack of markdown-it
 * plugins, so enumerating active syntax is unmaintainable (every plugin Joplin adds would
 * silently render raw in cells). Anything outside this set forces a render request instead.
 *
 * Deliberately excluded: quotes (`'` / `"`), because a single one is active under the
 * typographer setting, and `&`, because it opens HTML entities.
 */
const INERT_CHARACTERS_PATTERN = /^[\p{L}\p{N}\p{M}\s.,;:!?()/@#%$-]*$/u;

/**
 * Characters inert in isolation but active when they recur: `$math$`, `:emoji:`.
 */
const PAIRED_ACTIVATORS = ['$', ':'] as const;

/**
 * Characters inert in isolation but active when repeated adjacently, under the
 * typographer setting: `...` (ellipsis), `--` (en dash).
 */
const REPEATED_ACTIVATOR_PATTERN = /([.-])\1/;

function hasPairedActivator(text: string): boolean {
    return PAIRED_ACTIVATORS.some((char) => text.indexOf(char) !== text.lastIndexOf(char));
}

/**
 * Quick check for content that no markup engine can transform.
 * Lets plain-text cells skip the async render round-trip; everything else renders.
 *
 * Errs toward rendering: a false positive costs one cached render request, while a false
 * negative shows the user raw markup that Joplin's viewer would have rendered.
 */
export function mightContainMarkup(text: string): boolean {
    return !INERT_CHARACTERS_PATTERN.test(text) || hasPairedActivator(text) || REPEATED_ACTIVATOR_PATTERN.test(text);
}

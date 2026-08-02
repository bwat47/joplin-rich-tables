/**
 * The footnote anchor contract between the cell renderer and the click handler.
 *
 * Cells are rendered in isolation, which breaks markdown-it-footnote's document-wide
 * numbering, so the post-processor synthesizes its own links for `[^label]` text
 * (see htmlPostProcessor). Those hrefs are never consumed by anything outside this
 * plugin, so the format is defined here once and both sides go through it.
 */

const FOOTNOTE_HREF_PREFIX = '#fn-';

/** Href for a footnote reference to `label`. */
export function buildFootnoteHref(label: string): string {
    return `${FOOTNOTE_HREF_PREFIX}${encodeURIComponent(label)}`;
}

/**
 * The label a footnote href refers to, or null when `href` is not one of ours.
 * Reverses `buildFootnoteHref`, so the label matches the `[^label]:` definition
 * as the author wrote it — including spaces and non-ASCII characters.
 */
export function parseFootnoteHref(href: string): string | null {
    if (!href.startsWith(FOOTNOTE_HREF_PREFIX)) {
        return null;
    }

    const encoded = href.slice(FOOTNOTE_HREF_PREFIX.length);
    if (!encoded) {
        return null;
    }

    try {
        return decodeURIComponent(encoded);
    } catch {
        // Hand-authored href with a malformed escape (e.g. `#fn-100%`); the raw
        // text is the author's best guess at the label.
        return encoded;
    }
}

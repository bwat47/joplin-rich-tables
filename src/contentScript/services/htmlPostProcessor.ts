import { buildFootnoteHref } from '../shared/footnoteAnchor';

/**
 * Post-process rendered content to fix Joplin-specific display issues.
 * Includes KaTeX optimization and footnote reference conversion.
 *
 * Operates on the sanitized nodes in place, so neither pass has to parse the markup the way the
 * string form did.
 */
export function postProcessFragment(fragment: DocumentFragment): void {
    convertFootnoteRefs(fragment);
    cleanupAndOptimize(fragment);
}

/**
 * - Removes .joplin-source elements (raw text)
 * - Removes broken resource icon spans
 * - Extracts inner MathML from KaTeX structures to avoid duplicate/glitched rendering
 * - Removes <annotation> tags which might contain raw TeX
 */
function cleanupAndOptimize(fragment: DocumentFragment): void {
    // Remove Joplin source blocks
    fragment.querySelectorAll('.joplin-source').forEach((el) => el.remove());

    // Joplin resource links sometimes render an icon span that depends on editor-global
    // font/icon CSS (e.g. Font Awesome). Inside table cells this can degrade into a
    // broken glyph (often a question mark). Remove the icon element but keep the
    // resource link text and any placeholders.
    fragment.querySelectorAll('.resource-icon').forEach((el) => el.remove());

    // Optimize KaTeX: Replace HTML/CSS representation with clean MathML
    fragment.querySelectorAll('.katex').forEach((katexElement) => {
        const math = katexElement.querySelector('math');
        if (math) {
            // Remove annotations (often contains raw TeX)
            math.querySelectorAll('annotation').forEach((ann) => ann.remove());

            // Remove direct text node children of <math> - these are accessibility fallback
            // text that becomes visible when extracted from the hidden .katex-mathml span
            for (const child of Array.from(math.childNodes)) {
                if (child.nodeType === Node.TEXT_NODE) {
                    child.remove();
                }
            }

            // Check if wrapped in display mode
            const displayParent = katexElement.closest('.katex-display');
            if (displayParent) {
                displayParent.replaceWith(math);
            } else {
                katexElement.replaceWith(math);
            }
        }
    });
}

/**
 * A footnote reference with its label captured, e.g. `[^abc]` or `[^note 1]`.
 * The capture group is required: `convertFootnoteRefs` splits on this pattern
 * and reads the labels out of the resulting parts.
 */
const FOOTNOTE_REF_PATTERN = /\[\^([^\]]+)\]/;

/** The opening of a footnote reference. Cheap to test for, and almost no text node has one. */
const FOOTNOTE_REF_PREFIX = '[^';

/** Elements whose text is literal, so `[^label]` inside them is not a reference. */
const LITERAL_TEXT_TAGS = new Set(['CODE', 'PRE']);

/**
 * Convert [^label] patterns to footnote links, but only in text nodes
 * outside of <code> and <pre> elements.
 *
 * Markdown-it-footnote auto-numbers by first appearance, which breaks when
 * rendering cells independently. Instead, we convert any remaining [^label]
 * text into styled superscript links that preserve the original label.
 *
 * Recurses over text nodes, skipping code/pre elements.
 */
function convertFootnoteRefs(node: Node): void {
    for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE) {
            const el = child as Element;
            if (!LITERAL_TEXT_TAGS.has(el.tagName)) {
                convertFootnoteRefs(el);
            }
            continue;
        }

        if (child.nodeType !== Node.TEXT_NODE) {
            continue;
        }

        const fragment = buildFootnoteFragment(child.textContent || '');
        if (fragment) {
            child.replaceWith(fragment);
        }
    }
}

/**
 * The replacement for a text node containing footnote references, or null when
 * the text has none and the node should be left as it is.
 */
function buildFootnoteFragment(text: string): DocumentFragment | null {
    // Skip the regex split for the overwhelming majority of text nodes, which have no reference.
    if (!text.includes(FOOTNOTE_REF_PREFIX)) {
        return null;
    }

    // Splitting on a capturing pattern interleaves the parts: even indices are
    // the literal text between references, odd indices are the captured labels.
    const parts = text.split(FOOTNOTE_REF_PATTERN);
    if (parts.length === 1) {
        return null;
    }

    const fragment = document.createDocumentFragment();
    parts.forEach((part, index) => {
        if (index % 2 === 1) {
            fragment.appendChild(createFootnoteRef(part));
        } else if (part) {
            fragment.appendChild(document.createTextNode(part));
        }
    });

    return fragment;
}

/** `<sup class="footnote-ref"><a href="#fn-label">label</a></sup>` */
function createFootnoteRef(label: string): HTMLElement {
    const sup = document.createElement('sup');
    sup.className = 'footnote-ref';

    const a = document.createElement('a');
    a.href = buildFootnoteHref(label);
    a.textContent = label;

    sup.appendChild(a);
    return sup;
}

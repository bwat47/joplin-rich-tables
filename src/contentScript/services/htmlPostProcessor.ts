/**
 * Post-process rendered HTML to fix Joplin-specific display issues.
 * Includes KaTeX optimization and footnote reference conversion.
 */
export function postProcessHtml(html: string): string {
    return cleanupAndOptimizeHtml(convertFootnoteRefs(html));
}

/**
 * Post-process rendered HTML to fix Joplin-specific display issues.
 * - Removes .joplin-source elements (raw text)
 * - Removes broken resource icon spans
 * - Extracts inner MathML from KaTeX structures to avoid duplicate/glitched rendering
 * - Removes <annotation> tags which might contain raw TeX
 */
function cleanupAndOptimizeHtml(html: string): string {
    const template = document.createElement('template');
    template.innerHTML = html;

    // Remove Joplin source blocks
    for (const element of template.content.querySelectorAll('.joplin-source')) {
        element.remove();
    }

    // Joplin resource links sometimes render an icon span that depends on editor-global
    // font/icon CSS (e.g. Font Awesome). Inside table cells this can degrade into a
    // broken glyph (often a question mark). Remove the icon element but keep the
    // resource link text and any placeholders.
    for (const element of template.content.querySelectorAll('.resource-icon')) {
        element.remove();
    }

    // Optimize KaTeX: Replace HTML/CSS representation with clean MathML
    for (const katexElement of template.content.querySelectorAll('.katex')) {
        const math = katexElement.querySelector('math');
        if (math) {
            // Remove annotations (often contains raw TeX)
            for (const annotation of math.querySelectorAll('annotation')) {
                annotation.remove();
            }

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
    }

    return template.innerHTML;
}

/**
 * Convert [^label] patterns to footnote links, but only in text nodes
 * outside of <code> and <pre> elements.
 *
 * Markdown-it-footnote auto-numbers by first appearance, which breaks when
 * rendering cells independently. Instead, we convert any remaining [^label]
 * text into styled superscript links that preserve the original label.
 */
function convertFootnoteRefs(html: string): string {
    const template = document.createElement('template');
    template.innerHTML = html;
    processFootnotesInNode(template.content);
    return template.innerHTML;
}

/** Recursively process text nodes, skipping code/pre elements */
function processFootnotesInNode(node: Node): void {
    for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
            const text = child.textContent || '';
            if (/\[\^[^\]]+\]/.test(text)) {
                const fragment = document.createDocumentFragment();
                let lastIndex = 0;
                const regex = /\[\^([^\]]+)\]/g;
                let match;

                while ((match = regex.exec(text)) !== null) {
                    // Add text before the footnote
                    if (match.index > lastIndex) {
                        fragment.append(document.createTextNode(text.slice(lastIndex, match.index)));
                    }

                    const label = match[1];
                    const sup = document.createElement('sup');
                    sup.className = 'footnote-ref';

                    const a = document.createElement('a');
                    // Encode any unsafe characters in the label for the ID
                    a.href = `#fn-${encodeURIComponent(label)}`;
                    a.textContent = label;

                    sup.append(a);
                    fragment.append(sup);

                    lastIndex = regex.lastIndex;
                }

                // Add remaining text
                if (lastIndex < text.length) {
                    fragment.append(document.createTextNode(text.slice(lastIndex)));
                }

                child.replaceWith(fragment);
            }
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            const el = child as Element;
            if (el.tagName !== 'CODE' && el.tagName !== 'PRE') {
                processFootnotesInNode(el);
            }
        }
    }
}

/** The only line-break tag cell content carries, matching what the table serializer writes. */
const LINE_BREAK_TAG = '<br>';

/**
 * A fragment of literal text with `<br>` kept as a real line break.
 *
 * Used for content that has not been rendered: the plain-text placeholder shown while a render is
 * in flight, and the fallback when one fails. Every part becomes a text node, so markup in the
 * source is displayed rather than interpreted, without parsing HTML to achieve it.
 */
export function textFragmentPreservingBr(text: string, doc: Document = document): DocumentFragment {
    const fragment = doc.createDocumentFragment();
    const parts = text.split(LINE_BREAK_TAG);

    for (let index = 0; index < parts.length; index++) {
        if (index > 0) {
            fragment.appendChild(doc.createElement('br'));
        }

        const part = parts[index];
        if (part) {
            fragment.appendChild(doc.createTextNode(part));
        }
    }

    return fragment;
}

/**
 * Replaces an element's children with a fragment's nodes.
 *
 * `replaceChildren()` is deliberately avoided: it is missing from the WebView the mobile app uses.
 * Appending adopts nodes that belong to another document, which is how sanitized fragments arrive.
 */
export function replaceContent(target: HTMLElement, fragment: DocumentFragment): void {
    target.textContent = '';
    target.appendChild(fragment);
}

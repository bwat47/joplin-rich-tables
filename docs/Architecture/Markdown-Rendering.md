# Markdown Rendering

Table cells render Markdown through Joplin's `renderMarkup` command. The decision rationale and alternatives are covered in [ADR-006](../ADR/006-render-markup-cell-rendering.md); this document describes the implementation path.

## Rendering Service

`MarkdownRenderService` (`src/contentScript/services/markdownRenderer.ts`) renders Markdown to HTML via an extension-owned Joplin bridge:

- Content script calls `postMessage({ type: 'renderMarkup', markdown, id })`.
- Main plugin executes Joplin’s `renderMarkup` and returns HTML.
- The content script runs `sanitizeHtml()` → `postProcessHtml()` before using the HTML.

The renderer exposes `render(text): Promise<string>` plus cache helpers. It is created during content-script startup and installed through `markdownRenderServiceFacet`, so widgets and runtime code read the service from `view.state` instead of importing module-level mutable state.

### Cache + De-dupe

To avoid excessive rendering requests to the main plugin:

- FIFO cache (`MAX_CACHE_SIZE = 500`) for rendered HTML keyed by the Markdown payload.
- In-flight de-dupe (`pendingRequests`) so identical content only triggers one render request.
- Only request rendering for table cells that likely contain markdown formatting (`containsMarkdown` heuristic).

## Cell Payload Construction

Cells are stored inside a GFM table row, so `|` must be escaped (`\|`) to avoid being treated as a delimiter (even inside inline code, where `renderMarkup` will render the literal backslash). When rendering a cell as standalone Markdown, that escaping is no longer needed.

`buildRenderableContent()` (`src/contentScript/shared/cellContentUtils.ts`):

- Unescapes pipes (`\|` → `|`) to produce `displayText`, used as the plain-text fallback.
- Escapes leading block markers on `displayText` to produce `cacheKey`, the render payload and cache key, so isolated cells render as inline content instead of headings, lists, or blockquotes.

Cells are rendered as isolated Markdown fragments. Document-scoped reference-style links are not resolved from definitions elsewhere in the note. Footnotes are handled during post-processing because isolated cell renders cannot preserve document-wide footnote numbering.

## Sanitization + Post-processing

- Sanitization: `sanitizeHtml()` (`src/contentScript/services/htmlSanitizer.ts`) uses DOMPurify and a tight allowlist:
    - Allows Joplin-specific `data-*` attributes and `joplin-content://`-style URLs (`ALLOW_UNKNOWN_PROTOCOLS`).
    - Allows `<iframe>` but removes all iframes except specific `https://.../embed/...` YouTube sources.
    - Forbids `srcdoc`.
- Post-processing: `postProcessHtml()` (`src/contentScript/services/htmlPostProcessor.ts`):
    - Removes `.joplin-source` and `.resource-icon` elements that don’t render well inside cells.
    - Replaces KaTeX HTML with MathML to avoid duplicate/glitched rendering.
    - Footnotes: Post-processing replaces [^label] text with styled superscript links.

## Opening Links

Link opening is a separate service exposed through `linkOpenerFacet`. It forwards link opens to the main plugin (`postMessage({ type: 'openLink', href })`) so both internal Joplin links and external URLs resolve correctly.

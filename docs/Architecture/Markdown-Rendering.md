# Markdown Rendering

Table cells are rendered as isolated Markdown fragments, but Joplin’s renderer requires full-document context for certain functionality (reference style links, footnotes). The plugin bridges that gap with a rendering service plus document-context injection.

## Rendering Service

`MarkdownRenderService` (`src/contentScript/services/markdownRenderer.ts`) renders Markdown to HTML via the main plugin:

- Content script calls `postMessage({ type: 'renderMarkup', markdown, id })`.
- Main plugin executes Joplin’s `renderMarkup` and returns HTML.
- The content script runs `sanitizeHtml()` → `postProcessHtml()` before using the HTML.

### Cache + De-dupe

To avoid exessive rendering requests to the main plugin, the following optimizations are used:

- FIFO cache (`MAX_CACHE_SIZE = 500`) for rendered HTML keyed by the Markdown payload.
- In-flight de-dupe (`pendingRequests`) so identical content only triggers one render request.
- Only request rendering for table cells that likely contain markdown formatting (`containsMarkdown` heuristic).

## Cell Payload Construction

Cells are stored inside a GFM table row, so `|` must be escaped (`\|`) to avoid being treated as a delimiter (even inside inline code, where `renderMarkup` will render the literal backslash). When rendering a cell as standalone Markdown, that escaping is no longer needed.

`buildRenderableContent()` (`src/contentScript/shared/cellContentUtils.ts`):

- Unescapes pipes for display/rendering (`\|` → `|`).
- Optionally appends the document-level link definition block (below) to the render payload.
- Skips definition injection when the cell itself looks like a reference definition (`[label]: url`), to avoid rendering issues and unstable caching.

## Document Context Injection (Reference Links)

Reference-style links inside a cell (e.g. `[text][id]`) require definitions that usually live elsewhere in the note (e.g. `[id]: https://example.com`).

`documentDefinitionsField` (`src/contentScript/services/documentDefinitions.ts`) tracks reference link definitions for the whole document:

- Extracts `LinkReference` nodes from the syntax tree.
- Builds a Markdown `definitionBlock` that is appended to cell Markdown before rendering when needed.

**Note:** Footnotes are currently handled during post-processing because the context injection approach has issues with footnotes:

- markdown-it-footnote's auto-numbering doesn't work due to cells being rendered in isolation (even if we inject the footnote definitions, it's not aware of footnote links in other table cells, so each footnote link is numbered as #1).
- markdown-it-footnote renders the footnote definitions inside the table cell.

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

`openLink()` (`src/contentScript/services/markdownRenderer.ts`) forwards link opens to the main plugin (`postMessage({ type: 'openLink', href })`) so both internal Joplin links and external URLs resolve correctly.

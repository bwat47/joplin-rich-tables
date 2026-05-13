# ADR-006: Joplin renderMarkup for Cell Markdown Rendering

## Status

Accepted

## Context

The plugin replaces Markdown table source with an interactive HTML table widget. Cells need to display user-authored Markdown while preserving close parity with Joplin's Markdown viewer.

Important rendering requirements include:

- inline formatting such as emphasis, links, code, highlights, and inserted text
- Joplin resource links and internal links
- images, math, and other renderer-supported rich content
- behavior that follows Joplin renderer changes instead of diverging into a plugin-specific Markdown dialect

Cells are rendered as isolated fragments, while some Markdown features expect document context. Reference-style links can depend on definitions elsewhere in the note. Footnotes are also document-scoped because numbering is based on the full render context.

## Decision

Use Joplin's `renderMarkup` command as the primary Markdown-to-HTML renderer for table cells.

The content script sends Markdown render requests to the main plugin process, which calls `renderMarkup`. The returned HTML is sanitized and post-processed before insertion into the table widget DOM.

Rendering is optimized around the cell display model:

- Plain cells render synchronously as escaped HTML.
- Cells that look like Markdown render unescaped fallback text first, then asynchronously upgrade to `renderMarkup` HTML.
- Rendered HTML is cached by the normalized render payload.
- Identical in-flight render requests are de-duplicated.
- The active cell is edited through a nested CodeMirror editor; `renderMarkup` is used for display, not as the editing model.

Document-scoped reference-style links are intentionally unsupported in table cells; cells render only their own normalized Markdown payload. Footnotes are handled during HTML post-processing because isolated cell rendering breaks global footnote numbering and can render footnote definitions inside cells.

## Consequences

**Positive:**

- Table cells stay close to Joplin viewer behavior without reimplementing Joplin's Markdown pipeline.
- Rich content such as images, math, resource links, and renderer-supported extensions work through the same renderer users already expect.
- Renderer compatibility is delegated to Joplin, reducing plugin maintenance burden.
- Plain-text cells avoid async render overhead.
- Caching and in-flight de-dupe reduce repeated renderer calls for large or repetitive tables.

**Negative:**

- Rendering is asynchronous because content scripts must call into the main plugin process.
- Cell-level fragment rendering is not identical to full-document rendering.
- Document-scoped features remain approximate; reference-style links whose definitions live outside the cell are not resolved.
- Sanitization and post-processing are mandatory because renderer HTML is inserted into editor DOM (and to avoid breaking table cell layout, e.g. large elements like images).

## Alternatives Considered

1. **Active CodeMirror editor for every cell**: Rejected for display. This would create many editor instances, increase lifecycle and focus complexity, and make synchronization and undo behavior harder. CodeMirror is still used for the single active cell.

2. **Custom lightweight Markdown or HTML renderer**: Rejected as the primary renderer. It could be faster for simple inline Markdown, but it would drift from Joplin behavior and would require reimplementing support for rich content, internal links, resources, math, and security rules.

3. **CodeMirror parser plus syntax-highlighted spans**: Rejected for rendered-cell display. This is suitable for showing readable Markdown source, but it still exposes Markdown syntax characters and does not produce full rendered HTML.

4. **Render whole tables or larger document regions at once**: Rejected for now. This could improve document-scoped behavior, but it would require fragile HTML slicing and mapping back to individual editable cells.

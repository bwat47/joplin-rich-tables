# Markdown Rendering

Inactive table cells render Markdown through Joplin's `renderMarkup` command. The plugin treats each cell as an isolated fragment, then sanitizes the returned HTML before placing it in the widget. See [ADR-006](../ADR/006-render-markup-cell-rendering.md) for the rendering decision.

## Rendering Pipeline

`renderCellMarkdownInto()` is shared by table widgets and the nested editor when a cell closes. It first prepares table-cell text for standalone rendering: escaped pipes are unescaped for display, while leading block markers are escaped so a cell does not become a heading, list, or blockquote. Cached content appears immediately. On a cache miss, plain text appears first and Markdown-looking cells are upgraded asynchronously.

`MarkdownRenderService` sends those cells to Joplin through the content-script bridge. It is created at startup and supplied through an editor facet, so widgets and runtime code share one service. The service caches rendered content and combines concurrent requests for identical text. Each caller receives its own copy of the cached DOM fragment, and a late response cannot replace newer content in a cell.

## Safe Cell HTML

Joplin's rendered HTML passes through DOMPurify and `postProcessFragment()` before display. Sanitization keeps the Joplin attributes and resource URLs needed by cells while restricting embeds to approved YouTube sources. Post-processing removes unsuitable resource elements and adapts math and footnotes for the smaller cell context.

Because cells render independently, reference-style links cannot use definitions elsewhere in the note, and footnotes cannot retain document-wide numbering. Link opening is handled by a separate service that forwards internal and external links to Joplin.

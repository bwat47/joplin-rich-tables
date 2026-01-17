# Services and Parsing

## Markdown Rendering

`MarkdownRenderService` (`contentScript/services/markdownRenderer.ts`) converts cell Markdown to HTML.

- **Integration**: `postMessage` to main plugin → executes Joplin's `renderMarkup`.
- **Async**: Non-blocking for bulk updates.
- **Cache**: FIFO (500 entries) stores HTML for Markdown strings.
- **Sanitization**: DOMPurify (`contentScript/services/htmlSanitizer.ts`). Adds a controlled `iframe` allowlist for YouTube embeds and allows Joplin-specific data attributes and protocols.
- **Post-processing**: HTML fixes (`contentScript/services/htmlPostProcessor.ts`) run after sanitization.
    - **KaTeX**: Removes `.joplin-source` and replaces KaTeX HTML with MathML to avoid duplicate/glitched rendering.
    - **Footnotes**: `markdown-it-footnote` auto-numbering breaks in isolation. Post-processing replaces remaining `[^label]` text with styled superscript links.

## Table Parsing

`markdownTableRowScanner.ts` handles structural operations (Insert Column, etc.).

**Pipeline**:

1. Lezer detects table blocks (Table/TableRow nodes).
2. Row Scanner detects cell boundaries (Lezer lacks TableCell nodes for empty cells).

**Row Scanner**:

- Iterates line to identify pipe `|` delimiters.
- Respects `\|` escaping.
- Returns cell array with `content`, `start`, `end` positions.

## Context Injection

Isolated cell rendering loses document context (e.g., reference-style links `[text][id]`).

**Solution**: StateField in `documentDefinitions.ts` scans document for reference definitions `[id]: http://url`.

**Injection**: Definition map appended to cell Markdown payload before rendering. Allows renderer to resolve references in isolation.

Self-referencing syntax in cells is filtered to prevent recursion.

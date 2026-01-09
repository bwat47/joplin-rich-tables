# ADR-002: Definition Context Injection for Isolated Cell Rendering

## Status

Accepted

## Context

The Rich Tables plugin renders each table cell independently using Joplin's markdown renderer. This creates a problem for **reference-style links** which are defined elsewhere in the document:

```markdown
See [the docs][docs] for details.

[docs]: https://example.com
```

When the cell `See [the docs][docs] for details.` is rendered in isolation, the renderer has no knowledge of the `[docs]` definition—it exists outside the cell's render context. The reference link would fail to render as a clickable link.

### Why Footnotes Are Handled Differently

Footnotes (`[^1]`) are **not** handled by this mechanism. `markdown-it-footnote` auto-numbers footnotes based on their order of appearance in each render context. Since each cell is rendered independently, both `[^1]` and `[^2]` would become footnote #1 in their respective cells regardless of injection. Footnotes are instead handled via HTML post-processing.

## Decision

Implement a **definition context injection** mechanism:

1. **Extract definitions at document level**: A `StateField` (`documentDefinitionsField`) tracks all link reference definitions by iterating the Lezer syntax tree for `LinkReference` nodes.

2. **Build an injectable block**: Definitions are compiled into a markdown block (e.g., `[docs]: https://example.com`) ready for injection.

3. **Append to cell content before rendering**: When a cell contains link syntax (`[`), the definition block is appended to the cell content before passing to the renderer.

4. **Smart injection**: Definitions are only appended when:
    - Cell content contains `[` (potential reference link syntax)
    - Cell content is not itself a definition (prevents rendering issues)
    - Definition block is non-empty

### Implementation Files

- `documentDefinitions.ts`: StateField that extracts and tracks definitions
- `cellContentUtils.ts`: `buildRenderableContent()` handles conditional injection

## Consequences

**Positive:**

- Reference-style links work correctly inside table cells.
- Definitions are extracted incrementally via StateField (rebuilds only on document changes).
- Uses Lezer syntax tree for reliable extraction (respects CommonMark "first definition wins" rule).
- Smart injection avoids unnecessary work for cells without link syntax.

**Negative:**

- Slight increase in render payload size for cells with links.
- Definition extraction has a 200ms timeout; very large documents might occasionally return stale definitions.
- Cache keys include the full definition block, which may reduce cache hit rates if definitions change.

## Alternatives Considered

1. **Parse definitions on every cell render**: Rejected—too expensive, would re-scan the entire document for each cell.
2. **Render entire table at once**: Rejected—would require complex HTML slicing/manipulation to update individual cells or handle structural changes (add/delete rows/columns), making incremental updates fragile and error-prone.

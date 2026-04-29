# ADR-001: Lezer Table Detection with Plugin-Owned Cell Parsing

## Status

Accepted

## Context

CodeMirror 6 uses Lezer for Markdown syntax tree parsing. Lezer's Markdown parser can identify Markdown table blocks and rows, which is useful for deciding which document ranges should be replaced by rich table widgets.

However, the plugin needs more than table block detection. It needs precise and stable per-cell semantics for:

- click and keyboard navigation
- active-cell resolution
- nested editor source ranges
- copy/paste and selection behavior
- structural row and column operations
- serialization back to canonical Markdown table text

Lezer's `TableCell` nodes are not reliable enough as the source of truth for those responsibilities. In particular, `TableCell` nodes are only created for cells containing non-whitespace content, so empty cells produce no cell node.

Example: `| a | | c |` produces `TableCell` nodes for `a` and `c`, but not for the empty middle cell.

Because empty cells still need coordinates, editable ranges, selection behavior, and structural command semantics, the plugin cannot base its table model directly on `TableCell` nodes.

## Decision

Use Lezer to detect table blocks, but use plugin-owned parsing and range computation for table cells and table semantics.

The table model layer owns the following responsibilities:

- `scanMarkdownTableRow()` detects unescaped pipe delimiters within a row and is the single source of truth for row-level cell boundaries.
- `computeMarkdownTableCellRanges()` converts table text into semantic and editable source ranges for each cell.
- `MarkdownTable.parse()` builds the normalized runtime table model used for rendering, structural operations, and serialization.
- `TableContext` bundles the resolved table span, parsed `MarkdownTable`, and computed cell ranges so widget, navigation, and command code share the same derived table state.

Lezer remains responsible for locating candidate table blocks in the document. The plugin-owned parser is responsible for interpreting cell boundaries, cell ranges, alignments, ragged rows, and table-model semantics inside those blocks.

## Consequences

**Positive:**

- Empty cells are represented consistently.
- Cell coordinates do not depend on missing syntax tree nodes.
- Rendering, navigation, nested editing, and structural commands share one table interpretation.
- Editable ranges can intentionally differ from trimmed semantic ranges.
- Structural operations can rely on normalized table shape instead of raw syntax-tree gaps.
- The row scanner is simple and testable because it only detects unescaped `|` delimiters.

**Negative:**

- Duplicates some table interpretation already present in Lezer.
- The plugin must stay aligned with the Markdown table rules it claims to support.
- Edge cases may diverge from Lezer if the scanner and parser interpret table boundaries differently.
- More local invariants need to be maintained across row scanning, range computation, parsing, and serialization.

## Alternatives Considered

1. **Use Lezer `TableCell` nodes as the table model**: Rejected because empty cells do not produce nodes, making column coordinates and editable ranges unreliable.

2. **Infer empty cells from gaps between Lezer nodes**: Rejected as fragile. It requires reconstructing line-local table structure from tree gaps and offsets, and becomes harder to reason about with multiple empty cells or irregular rows.

3. **Use `TableDelimiter` nodes from the syntax tree**: Rejected for cell-boundary ownership. The same node type is used for per-pipe row delimiters and separator-row syntax, so callers would still need additional tree-shape and offset-mapping logic to recover simple row-local boundary positions.

4. **Split rows with ad hoc string operations at each call site**: Rejected because it would create competing interpretations of escaped pipes, empty cells, and range ownership. All cell-boundary logic should flow through `scanMarkdownTableRow()`.

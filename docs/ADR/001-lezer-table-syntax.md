# ADR-001: Lezer-Owned Table Syntax with Plugin-Owned Semantics

## Status

Accepted

## Context

The plugin needs one interpretation of GFM table syntax across document rendering, cell activation, clipboard parsing,
and normalization. The former row scanner duplicated part of Lezer's grammar and could disagree with the syntax tree
about escaped pipes, row membership, or the table's end.

Lezer's `TableCell` nodes alone are insufficient because empty cells do not produce nodes. Empty cells still need
coordinates and insertion points, including adjacent forms such as `|| b |`.

## Decision

Lezer is authoritative for table recognition, table extent, row membership, pipe delimiters, and non-empty cell
content spans.

- In editor documents, use the existing CodeMirror syntax tree.
- For standalone and clipboard text, use one shared `@lezer/markdown` parser configured with GFM.
- Support only a `Table` whose direct parent is `Document`. Tables in blockquotes, lists, or other containers remain
  plain source.
- Convert accepted nodes to a table-relative `MarkdownTableSyntax` value. Reconstruct raw cells from adjacent direct
  `TableDelimiter` children and associate any direct `TableCell` content node with its raw cell. A `TableRow` without
  pipe delimiters is one cell.
- Reject malformed node shapes. Standalone input must contain exactly one root table plus optional outer whitespace.
- Use the exact Lezer `Table` range. A pipe-free line that Lezer includes is a body row; it is no longer removed by a
  trailing-line heuristic.

The plugin remains authoritative for editor and application semantics:

- Semantic content bounds use `TableCell`; empty-cell insertion points and editable bounds derive from raw delimiter
  gaps. Editable bounds remove at most one adjacent ASCII space or tab on each side.
- The normalized rectangular grid, alignment values, structural operations, and canonical serialization remain in
  `MarkdownTable`.
- Existing adjacent pipe-free text is canonicalized as a padded row when an existing edit boundary triggers
  normalization. Transaction-aware boundary maintenance still preserves text newly typed or pasted into a previously
  blank line below a rendered table as a neighboring paragraph.

## Consequences

There is one syntax authority, so document resolution, standalone parsing, the table model, and cell ranges cannot
silently diverge over Markdown grammar. Empty cells and editable padding still require a small plugin-owned projection
because Lezer intentionally does not model editing behavior.

This decision also adopts Lezer's ambiguous no-blank-line behavior. A line directly below a table can be a one-cell
row even without a pipe. Callers that intend a following paragraph must preserve a blank boundary.

One grammar is not one runtime. The plugin bundles its own `@lezer/markdown` parser for standalone and clipboard
text, while the editor uses the host's. Both run the same grammar, but their versions move independently, so a host
upgrade can put editor behavior ahead of clipboard behavior until this dependency follows. Grammar limitations are
shared rather than plugin-owned: Lezer 1.6.3 rejects a delimiter row carrying trailing whitespace, which the clipboard
wrapper normalizes away before parsing.

Root-only support is an explicit scope limit, not a parser limitation. Supporting tables inside containers would need
separate source-rewrite and indentation semantics.

## Alternatives Considered

1. **Use only `TableCell` nodes:** Rejected because empty cells have no node and therefore no coordinate or insertion
   point.
2. **Keep the custom row scanner:** Rejected because it duplicates escaped-delimiter and row-shape syntax and can
   disagree with Lezer about what belongs to a table.
3. **Add a custom external tokenizer for cell ranges:** Rejected because it creates another grammar extension to
   package and maintain, while direct delimiter children already expose the missing empty-cell structure. It would
   also make behavior depend on whether the host content-script parser can be reconfigured.
4. **Support nested tables now:** Rejected because container indentation and rewrite boundaries are outside the
   current feature contract.

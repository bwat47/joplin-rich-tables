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
- For clipboard text, use one shared `@lezer/markdown` parser configured with GFM. Clipboard text is the only source
  the editor has not already parsed, so it is the only place a second parser runs.
- Normalize clipboard text before parsing: fold line endings and drop trailing delimiter-row padding. That padding is
  invisible in a pasted payload but can stop Lezer recognizing the table at all. Other rows remain untouched until
  Lezer classifies their content.
- Support only a `Table` whose direct parent is `Document`. Tables in blockquotes, lists, or other containers remain
  plain source.
- Convert accepted nodes to a table-relative `MarkdownTableSyntax` value. Reconstruct raw cells from adjacent direct
  `TableDelimiter` children and associate any direct `TableCell` content node with its raw cell. A `TableRow` without
  pipe delimiters is one cell.
- Reject malformed node shapes. Clipboard input must contain exactly one root table plus optional outer whitespace.
- Use the exact Lezer `Table` range. A pipe-free line that Lezer includes is a body row; it is no longer removed by a
  trailing-line heuristic.

The plugin remains authoritative for editor and application semantics:

- Semantic content bounds use `TableCell` minus trailing ASCII padding. An odd trailing backslash makes Lezer pull the
  following space or tab into the node; that pad is layout, so treating it as content would widen the cell on every
  round trip and show the pad inside the cell editor. Empty-cell insertion points and editable bounds derive from raw
  delimiter gaps, independently removing at most one adjacent ASCII space or tab per side. Keeping padding outside
  edits protects pipe delimiters.
- Row extents exclude trailing ASCII spaces and tabs that lie outside the final `TableCell`. Lezer row nodes cover that
  padding, but it belongs to no cell: treating it as one detaches the closing pipe from the last cell and adds a phantom
  trailing column. Trimming stops at the final `TableCell` node, including the pad an odd backslash pulls into it.
- The normalized rectangular grid, alignment values, structural operations, and canonical serialization remain in
  `MarkdownTable`.
- Cell offsets within a serialized table are derived from the canonical row format, never by parsing that
  serialization back. `MarkdownTable` owns the format, so it can say where a cell landed without a second parse.
- Existing adjacent pipe-free text is canonicalized as a padded row when an existing edit boundary triggers
  normalization. Transaction-aware boundary maintenance still preserves text newly typed or pasted into a previously
  blank line below a rendered table as a neighboring paragraph.

## Consequences

There is one syntax authority, so document resolution, clipboard parsing, the table model, and cell ranges cannot
silently diverge over Markdown grammar. Empty cells and editable padding still require a small plugin-owned projection
because Lezer intentionally does not model editing behavior.

A pipe-free line directly below a table becomes a one-cell row. This matches Joplin's default viewer, whose markdown-it
GFM rule renders the same row padded with an empty trailing cell; the former trailing-line heuristic was the divergent
side. Block constructs - headings, lists, blockquotes, fenced code, HTML - end the table in both engines, so only prose
is absorbed. The opt-in Multi-Markdown Table setting (`markdown.plugin.multitable`, default off) splits that line into a
paragraph instead, so callers that intend a following paragraph must preserve a blank boundary.

One module, two configurations. The content script externalizes `@lezer/markdown`, so the clipboard wrapper and the
editor share the host's module and version; the `package.json` entry is build-time only. What differs is configuration:
the wrapper enables GFM alone, while Joplin's editor also enables front matter and, by setting, math, highlight and
insert extensions. Only block-level additions could classify the same text differently. Grammar limitations are shared
rather than plugin-owned: the tested grammar rejects a delimiter row carrying trailing whitespace, which the wrapper
normalizes away before parsing.

That exposure is bounded by how little the wrapper is asked. It answers one question - is this pasted string a
single table - and nothing else reaches it. Text the plugin produces itself is ranged from the model that produced
it.

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

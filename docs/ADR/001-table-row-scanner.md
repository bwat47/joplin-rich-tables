# ADR-001: Custom Table Row Scanner

## Status

Accepted

## Context

CodeMirror 6 uses Lezer for syntax tree parsing. Lezer's Markdown parser provides `Table`, `TableRow`, and `TableCell` nodes. However, **`TableCell` nodes are only created for cells containing non-whitespace content**—empty cells produce no node.

Example: `| a | | c |` produces a tree with `TableCell` nodes only for "a" and "c", not for the empty middle cell.

Because TableCell nodes are omitted for empty cells, TableCell nodes alone cannot reliably determine column indices or represent empty cells. While this can be reconstructed from other syntax nodes such as TableDelimiter, doing so is more complex than scanning row text directly.

## Decision

Implement a custom `markdownTableRowScanner.ts` that iterates through table row text to identify cell boundaries by detecting pipe `|` delimiters while respecting escaped pipes `\|`.

## Consequences

**Positive:**

- All cells (including empty) are treated uniformly.
- Delimiter-based column boundaries are consistent for scanned rows.
- Structural operations (insert/delete column) can rely on explicit cell boundaries.
- No need to infer empty cells from gaps in `TableCell` nodes.

**Negative:**

- Duplicates some cell-boundary detection work already done indirectly by Lezer.
- Must stay aligned with the plugin's supported Markdown table row rules.
- Slight behavior difference: the plugin's table-model logic may stop at the last pipe-containing row, while Lezer may continue treating subsequent lines as part of the table until a terminating blank line.

## Alternatives Considered

1. **Infer empty cells from Lezer gaps**: Rejected—fragile and error-prone when tables have complex content or multiple empty cells.
2. **Use `TableDelimiter` nodes from the syntax tree**: Rejected—more complex than scanning row text directly. The same node type is used for both per-pipe delimiters in rows and the separator row, so callers would still need extra tree-shape and offset-mapping logic to recover simple line-local boundary positions.

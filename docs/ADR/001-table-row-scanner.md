# ADR-001: Custom Table Row Scanner

## Status

Accepted

## Context

CodeMirror 6 uses Lezer for syntax tree parsing. Lezer's Markdown parser provides `Table`, `TableRow`, and `TableCell` nodes. However, **`TableCell` nodes are only created for cells containing non-whitespace content**—empty cells produce no node.

Example: `| a | | c |` produces a tree with `TableCell` nodes only for "a" and "c", not for the empty middle cell. This makes it impossible to reliably determine column indices or detect empty cells from the syntax tree alone.

## Decision

Implement a custom `markdownTableRowScanner.ts` that iterates through table row text to identify cell boundaries by detecting pipe `|` delimiters while respecting escaped pipes `\|`.

## Consequences

**Positive:**

- All cells (including empty) are treated uniformly.
- Column indices are always accurate.
- Structural operations (insert/delete column) work correctly.
- No need to infer empty cells from gaps in the syntax tree.

**Negative:**

- Duplicates some parsing work already done by Lezer.
- Must be kept in sync with Markdown table syntax rules.
- Slight behavior difference: Lezer considers all content after the last row (until an empty line) as part of the table, while the scanner stops at the last row with pipes.

## Alternatives Considered

1. **Infer empty cells from Lezer gaps**: Rejected—fragile and error-prone when tables have complex content or multiple empty cells.
2. **Patch Lezer grammar**: Rejected—would require forking the grammar and maintaining it separately.

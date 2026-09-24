# Table Parsing

Lezer is the source of truth for Markdown table syntax. The plugin turns its syntax tree into cell ranges and a normalized table model; it does not parse table rows independently. See [ADR-001](../ADR/001-lezer-table-syntax.md) for the rationale.

## From Syntax to Table Context

`lezerTableSyntax.ts` projects a Lezer table node into table-relative rows, cells, and separator information. The projection preserves the exact accepted table text so all later offsets refer to the same source. It distinguishes cell content from Markdown delimiters and padding, including empty cells. Unsupported syntax shapes are left as Markdown source rather than rendered as an incorrect table.

`markdownTableCellRanges.ts` derives the bounds used to locate and edit cells. Semantic content ranges describe what belongs to a cell; editable ranges exclude delimiter-adjacent padding so editing and serialization do not accidentally change table structure.

`MarkdownTable` uses the syntax projection to build a rectangular model for rendering and structural commands. It owns canonical serialization and the offsets of cells in serialized output. Clipboard parsing uses the same Lezer-based path. Callers that already have table data can construct the model directly.

## Document Index

`tableContextField` is the authoritative index of tables in the main editor. It scans the current syntax tree for tables directly under the document root, then publishes document-ordered `TableContext` values containing source spans, cell ranges, and normalized models. Tables nested in other Markdown blocks and tables that cannot start a line-aligned block widget remain visible as source.

The index is refreshed on document changes. It can reuse derived data for unchanged table text, but each context receives current document positions. If a complete syntax tree is unavailable within the parse budget, the field exposes an incomplete empty index instead of stale spans. A later update rebuilds it once parsing has produced a complete tree.

`TableContext` is a read-only projection of the document. Editing, paste, and structural commands decide when to rewrite a table into canonical Markdown; indexing itself never changes source text. Runtime state stores logical cell identity and resolves current offsets through the index. See [Table-Runtime-Invariants.md](./Table-Runtime-Invariants.md) for those rules and [Structural-Commands-and-Serialization.md](./Structural-Commands-and-Serialization.md) for table rewrites.

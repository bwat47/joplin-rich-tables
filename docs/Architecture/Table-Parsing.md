# Table Parsing

Lezer owns Markdown table syntax; the plugin projects those facts into editable ranges and a normalized table model.
See [ADR-001](../ADR/001-lezer-table-syntax.md) for the decision rationale.

## Syntax Adapter

`lezerTableSyntax.ts` exposes a read-only, table-relative `MarkdownTableSyntax` value:

- `TableHeader` and direct `TableRow` nodes define row membership.
- Direct row `TableDelimiter` children define raw cell gaps, including adjacent empty cells.
- Optional `TableCell` children define non-empty semantic content spans.
- The table-level separator node supplies the already validated alignment-row source.

Document resolution extracts this value from the existing CodeMirror tree and accepts only `Table` nodes directly
under `Document`. Tables inside lists, blockquotes, or other containers are not rendered. Standalone APIs parse with a
shared GFM Lezer parser and accept exactly one root table plus optional outer whitespace.

The adapter fails closed on unexpected tree shapes. A direct `TableRow` without pipe delimiters becomes one raw cell,
matching Lezer's treatment of pipe-free lines adjacent to a table.

## Cell Ranges

`computeMarkdownTableCellRangesFromSyntax()` converts syntax spans into table-relative editing coordinates:

- `from/to` use a `TableCell` span for non-empty content.
- Empty cells receive a stable zero-width insertion point reconstructed from the raw delimiter gap.
- `editableFrom/editableTo` remove at most one delimiter-adjacent ASCII space or tab on each side.
- Other whitespace, including Unicode whitespace that Lezer includes in `TableCell`, remains content.

`computeMarkdownTableCellRanges(text)` is a convenience API for standalone text and delegates to the Lezer adapter.
Cell lookup uses editable bounds; the nested editor uses both semantic and editable bounds.

## Normalized Model

`MarkdownTable.fromSyntax()` reads cell content from syntax spans and alignment markers from the separator-node source.
It then pads the header, alignments, and body rows to a rectangular grid. A pipe-free row is consequently padded to the
table width and serializes canonically—for example, `text` in a two-column table becomes `| text |  |`.

`MarkdownTable.parse(text)` is the standalone convenience API and delegates to the shared Lezer parser. Lezer validates
table and separator syntax; the model does not maintain a competing row scanner or separator validator.

## Runtime Resolution and Context

`tableResolution.ts` returns exact root-level Lezer table ranges together with `MarkdownTableSyntax`. Point lookup and
full-document discovery therefore share the same range and root classification.

`buildTableContext()` derives both `MarkdownTable` and cell ranges from the supplied syntax value without reparsing.
Its LRU cache remains keyed by exact table source text and stores the derived model and ranges together.

`TableContext` is passive derived state and never rewrites the document. Canonicalization occurs only at existing cell
entry, paste, or structural-operation boundaries. Existing adjacent pipe-free text is normalized as a row. Separately,
transaction-aware boundary maintenance detects text typed or pasted into a previously blank line below a rendered
table and restores spacing in the same transaction, keeping that new text outside the table.

## Active Cells and Structural Operations

`ActiveCell` remains logical: `tableFrom` plus section, row, and column. Runtime code resolves current document spans
from `TableContext`; stale cells are cleared instead of clamped.

Structural edits operate on `MarkdownTable` and serialize canonical Markdown. See
[Structural-Commands-and-Serialization.md](./Structural-Commands-and-Serialization.md).

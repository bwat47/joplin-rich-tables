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
under `Document`. Tables inside lists, blockquotes, or other containers are not rendered. Clipboard parsing uses a
shared GFM Lezer parser and accepts exactly one root table plus optional outer whitespace.

Row spans exclude trailing ASCII spaces and tabs outside the final `TableCell`. Lezer row nodes cover that padding, but
it belongs to no cell: counting it detaches the closing pipe from the last cell and yields a phantom trailing column.
Trimming never crosses whitespace that Lezer classified as cell content.

The adapter fails closed on unexpected tree shapes. A direct `TableRow` without pipe delimiters becomes one raw cell,
matching Lezer's treatment of pipe-free lines adjacent to a table.

## Cell Ranges

`computeMarkdownTableCellRangesFromSyntax()` converts syntax spans into editing coordinates relative to the supplied
text, rebasing them when the table starts at a nonzero offset:

- `from/to` use a `TableCell` span for non-empty content.
- Empty cells receive a stable zero-width insertion point reconstructed from the raw delimiter gap.
- `editableFrom/editableTo` independently remove at most one delimiter-adjacent ASCII space or tab on each side.
  Padding stays outside edits even when Lezer includes it in semantic content after a backslash, so deleting at the
  cell's end cannot escape the next pipe. Entry normalization preserves source-owned escaped whitespace and adds
  separate serialization padding around it.
- Other whitespace, including Unicode whitespace that Lezer includes in `TableCell`, remains content.

Cell lookup uses editable bounds; the nested editor uses both semantic and editable bounds. Tests compose the Lezer
parser and range projection through `parseCellRangesFixture()` in their shared utilities. The resulting ranges also
provide an independent check of `MarkdownTable.serializedCellOffset()` arithmetic.

## Normalized Model

`MarkdownTable.fromSyntax()` reads cell content from syntax spans and alignment markers from the separator-node source.
It then pads the header, alignments, and body rows to a rectangular grid. A pipe-free row is consequently padded to the
table width and serializes canonically—for example, `text` in a two-column table becomes `| text |  |`.

`MarkdownTable.parse(text)` delegates to the shared Lezer parser and is reached only from clipboard handling. Lezer
validates table and separator syntax; the model does not maintain a competing row scanner or separator validator.

`MarkdownTable.serialize()` writes the canonical row format, and `MarkdownTable.serializedCellOffset()` reports where a
cell lands in that output using the same format constants. Callers that have just serialized a table therefore locate a
cell without parsing their own output back.

## Runtime Resolution and Context

`tableResolution.ts` returns a root-classified span and its syntax node, reading no source text. Point lookup and
full-document discovery therefore share the same range and root classification, and callers that only test containment
pay nothing more.

`buildTableContext()` owns the whole derivation behind one 50-entry LRU keyed by exact table source text: syntax
extraction, the normalized model, and cell ranges. Identical tables share an entry safely because that text determines
every value derived from it.

`TableContext` is passive derived state and never rewrites the document. Canonicalization occurs only at existing cell
entry, paste, or structural-operation boundaries. Existing adjacent pipe-free text is normalized as a row. Separately,
transaction-aware boundary maintenance detects text typed or pasted into a previously blank line below a rendered
table and restores spacing in the same transaction, keeping that new text outside the table.

## Active Cells and Structural Operations

`ActiveCell` remains logical: `tableFrom` plus section, row, and column. Runtime code resolves current document spans
from `TableContext`; stale cells are cleared instead of clamped.

Structural edits operate on `MarkdownTable` and serialize canonical Markdown. See
[Structural-Commands-and-Serialization.md](./Structural-Commands-and-Serialization.md).

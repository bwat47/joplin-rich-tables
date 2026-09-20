# Table Parsing

Lezer owns Markdown table syntax; the plugin projects those facts into editable ranges and a normalized table model.
See [ADR-001](../ADR/001-lezer-table-syntax.md) for the decision rationale.

## Syntax Adapter

`lezerTableSyntax.ts` exposes a read-only, table-relative `MarkdownTableSyntax` value:

- `TableHeader` and direct `TableRow` nodes define row membership.
- Direct row `TableDelimiter` children define raw cell gaps, including adjacent empty cells.
- Optional `TableCell` children define non-empty semantic content spans after trailing ASCII spaces and tabs are removed.
- The table-level separator node supplies the already validated alignment-row source.

`parseRootMarkdownTableSyntax()` returns `{ tableText, syntax }`. After the enclosing input is validated, `tableText`
is the exact accepted table slice, and every syntax offset is relative to that slice. Optional outer whitespace is
accepted and dropped; it never appears in `tableText` or in syntax coordinates. Row-internal whitespace and padding
remain part of `tableText`.

Document resolution extracts this value from the existing CodeMirror tree and accepts only `Table` nodes directly
under `Document`. Tables inside lists, blockquotes, or other containers are not rendered. Clipboard parsing uses a
shared GFM Lezer parser and accepts exactly one root table plus optional outer whitespace.

Row spans exclude trailing ASCII spaces and tabs outside the final `TableCell`. Lezer row nodes cover that padding, but
it belongs to no cell: counting it detaches the closing pipe from the last cell and yields a phantom trailing column.
Row trimming stops at the final `TableCell` node, including any padding Lezer pulls in after an odd trailing backslash.
Semantic content spans exclude that padding even though it remains inside the row span.

The adapter fails closed on unexpected tree shapes. A direct `TableRow` without pipe delimiters becomes one raw cell,
matching Lezer's treatment of pipe-free lines adjacent to a table.

## Cell Ranges

`computeMarkdownTableCellRangesFromSyntax()` converts syntax spans into editing coordinates relative to the supplied
exact table text. Callers must pass that table text; all returned ranges are table-relative:

- `from/to` use a `TableCell` span minus trailing ASCII padding for non-empty content.
- Empty cells receive a stable zero-width insertion point reconstructed from the raw delimiter gap.
- `editableFrom/editableTo` independently remove at most one delimiter-adjacent ASCII space or tab on each side.
  This keeps padding outside edits so a trailing backslash cannot escape the next pipe. The space or tab Lezer pulls
  into `TableCell` after an odd trailing backslash is excluded from semantic content. Entry normalization therefore
  writes only the canonical serialization padding, keeping repeated serialization stable.
- Other whitespace, including Unicode whitespace that Lezer includes in `TableCell`, remains content.

Cell lookup uses editable bounds; the nested editor uses both semantic and editable bounds. Tests compose the Lezer
parser and range projection through `parseCellRangesFixture()` in their shared utilities. That helper projects
`parsed.tableText`, so returned ranges stay table-relative even when a fixture includes outer whitespace. The resulting
ranges also provide an independent check of `MarkdownTable.serializedCellOffset()` arithmetic.

## Normalized Model

`MarkdownTable.fromSyntax()` reads cell content from syntax spans and alignment markers from the separator-node source
against the exact table text. It then pads the header, alignments, and body rows to a rectangular grid. A pipe-free row
is consequently padded to the table width and serializes canonically—for example, `text` in a two-column table becomes
`| text |  |`.

`MarkdownTable.parse(text)` delegates to the shared Lezer parser and is reached only from clipboard handling. Lezer
validates table and separator syntax; the model does not maintain a competing row scanner or separator validator.
Callers that already know a table's cells, such as the empty table produced by the insert command, build it with
`MarkdownTable.fromParts()` rather than writing markdown only to parse it back.

`MarkdownTable.serialize()` writes the canonical row format, and `MarkdownTable.serializedCellOffset()` reports where a
cell lands in that output using the same format constants. Callers that have just serialized a table therefore locate a
cell without parsing their own output back.

## Runtime Resolution and Context

`tableContextField` is the sole semantic index of root tables in the main document. On creation and every document
change it scans the current Lezer tree's top-level nodes once, then publishes document-ordered `TableContext` values. Selectors
read containment and range queries from that field; they fail fast when used with a state that did not register it.

The scan also requires a table to begin at the start of its line. Markdown allows one to three leading spaces, and
Lezer opens the `Table` node at the first pipe, so an indented table would start mid-line. Block decorations and
boundary spacing are both line-based: a widget starting mid-line leaves the indent on a visible line above itself, and
`resolveBoundaryPadding()` declines to pad a table whose edges are not line edges. Indented tables therefore stay
unindexed and render as source. Indentation on later rows is harmless, because it sits inside the table span and
outside every row node; serialization drops it at the next canonicalization boundary.

The warm path uses `syntaxTree()` directly when `syntaxTreeAvailable()` confirms the complete document is parsed.
Otherwise the field calls `ensureSyntaxTree()` with the centralized `SYNTAX_TREE_BUDGET_MS` value of 1000 ms. That
budget is a worst-case ceiling for cold or replaced documents, not a per-keystroke target; warm incremental parsing
normally finishes before the fallback is needed.

Each scan builds a text-keyed reuse map from the previous index and adds newly derived entries to it. Exact duplicate
table text therefore shares the normalized model and relative cell ranges within the current scan, while every context
gets current syntax-tree spans. There is no module-level cache or independent incremental invalidation algorithm.

If parsing misses the budget, the field publishes an explicitly incomplete empty index rather than stale spans. A
later parser-progress transaction rescans once the complete tree is available.

`buildTableContext()` is a cache-free derivation, and `TableContext` is passive state that never rewrites the document.
Canonicalization occurs only at existing cell entry, paste, or structural-operation boundaries. Existing adjacent
pipe-free text is normalized as a row. Separately,
transaction-aware boundary maintenance detects text written into a previously blank line beside a rendered table and
restores spacing in the same transaction, keeping that new text outside the table. It inspects every document change
except composition, deletion, and undo/redo, because host commands such as Joplin's `insertText` - the path other
plugins insert through - dispatch without a user event to match on.

## Active Cells and Structural Operations

`ActiveCell` remains logical: `tableFrom` plus section, row, and column. Runtime code resolves current document spans
from `TableContext`; stale cells are cleared instead of clamped.

Structural edits operate on `MarkdownTable` and serialize canonical Markdown. See
[Structural-Commands-and-Serialization.md](./Structural-Commands-and-Serialization.md).

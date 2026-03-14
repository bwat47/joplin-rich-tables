# Table Parsing

The plugin needs precise, stable character ranges for each cell to support click mapping, nested editing, and structural edits. Lezer is used to locate table blocks, but the plugin does its own per-cell parsing.

## Why Not Just Lezer?

Lezer’s Markdown table support identifies table blocks/rows, but it doesn’t provide reliable per-cell nodes/ranges in all cases (notably for empty cells). The plugin therefore treats Lezer as a “table block detector” and performs its own cell-boundary scanning.

## Single Source of Truth: Row Scanning

`scanMarkdownTableRow()` (`src/contentScript/tableModel/markdownTableRowScanner.ts`) is the only place that determines where cell boundaries are:

- Iterates a row string and returns indices of unescaped `|` delimiters.
- Treats `\|` as literal content inside a cell.

Everything else in the table model layer builds on this scanner (don’t split on `|` manually).

## Computing Cell Ranges (Editing Coordinates)

`computeMarkdownTableCellRanges()` (`src/contentScript/tableModel/markdownTableCellRanges.ts`) converts table text into source ranges:

- Filters to non-empty lines (matching the parser’s behavior).
- Validates the separator row with `isSeparatorRow()`, but intentionally does not return ranges for the separator row.
- Trims outer whitespace and ignores leading/trailing pipes.
- Trims per-cell whitespace; for whitespace-only cells it chooses a stable insertion point so edits don’t “stick” directly to a pipe in the plugin’s canonical padded format.

These ranges are used for:

- Mapping positions back to cell coordinates (`findCellForPos()`).
- Resolving a cell’s `from/to` range (`getCellRange()`).
- Deriving live `cellFrom/cellTo` values for logical active-cell state.

## Parsing to a Structured Table Model

`MarkdownTable.parse()` (`src/contentScript/tableModel/MarkdownTable.ts`) produces the canonical runtime table model:

- Validates basic shape (header row contains `|`, second row is a separator row).
- Parses column alignments from the separator row (`:---`, `:---:`, `---:`, `---`) using a dedicated separator-row parser.
- Extracts header/body cell content by slicing the original text with `computeMarkdownTableCellRanges()` so displayed content and edit ranges stay consistent.
- Normalizes ragged input immediately so headers, alignments, and body rows always share the same effective column count.

## Shared `TableContext`

`buildTableContext()` (`src/contentScript/tableModel/tableContext.ts`) is the shared entry point for consumers that need both the parsed table model and editing coordinates.

It returns:

- The resolved table span (`from`, `to`, `text`).
- The parsed `MarkdownTable`.
- The computed `cellRanges`.

This avoids duplicated resolve/parse/range work across:

- Table widget decoration building.
- Mouse interaction and cell activation.
- Keyboard navigation.
- Structural command helpers.

The cache is an LRU map keyed by table text hash and stores both `MarkdownTable` and `cellRanges` together.

`TableContext` is read-only derived state. It may expose that the current table text is non-canonical, but it never
rewrites the document by itself. Canonicalization happens only when the user crosses into interactive cell editing.

## Active Cell Resolution

`ActiveCell` itself is intentionally logical-first: `tableFrom` plus `section/row/col`.

When code needs current document offsets for the active table/cell, it must resolve them from
the current editor state through the shared active-cell resolver. That resolver:

- Re-resolves the anchored table from `tableFrom`.
- Rebuilds `TableContext`.
- Derives `tableTo` and `cellFrom/cellTo` from current `cellRanges`.

If resolution fails, the active cell is treated as stale and cleared rather than clamped to a nearby cell.

## Structural Operations (Rows/Columns/Alignment)

Structural edits operate on `MarkdownTable` and then serialize back to Markdown, see: [Structural-Commands-and-Serialization.md](./Structural-Commands-and-Serialization.md)

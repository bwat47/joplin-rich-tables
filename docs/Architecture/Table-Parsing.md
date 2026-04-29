# Table Parsing

Lezer locates table blocks; plugin-owned parsing computes cell boundaries, source ranges, and table semantics. The decision rationale is covered in [ADR-001](../ADR/001-table-row-scanner.md); this document describes the implementation path.

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
- Produces two bounds per cell:
    - `from/to`: trimmed semantic content bounds used for parsing/rendering.
    - `editableFrom/editableTo`: editing bounds used by the nested editor and selection sync.
- Editable bounds hide one delimiter-adjacent pad character per side while preserving any additional leading/trailing whitespace the user typed into the cell.
- For empty or whitespace-only cells, editable bounds collapse to a stable insertion point so edits don’t “stick” directly to a pipe in the plugin’s canonical padded format.

These ranges are used for:

- Mapping positions back to cell coordinates (`findCellForPos()`), using the editable span.
- Resolving a cell’s semantic/editable ranges (`getCellRange()`).
- Deriving live semantic/editable document spans for logical active-cell state.

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

Selection placement is separate transient state. Code that needs to move the main-editor cursor into the active cell
threads an explicit selection anchor rather than persisting that offset inside `ActiveCell`.

When code needs current document offsets for the active table/cell, it must resolve them from
the current editor state through the shared active-cell resolver. That resolver:

- Re-resolves the anchored table from `tableFrom`.
- Rebuilds `TableContext`.
- Derives `tableTo`, trimmed content bounds, and editable bounds from current `cellRanges`.

The resulting `ResolvedActiveCell` is the standard transient runtime object for active-cell-aware code. Once a concrete
current-state cell has been chosen, runtime paths should pass `ResolvedActiveCell` rather than re-threading separate
`ActiveCell`, `TableContext`, and raw offset fields.

If resolution fails, the active cell is treated as stale and cleared rather than clamped to a nearby cell.

## Structural Operations (Rows/Columns/Alignment)

Structural edits operate on `MarkdownTable` and then serialize back to Markdown, see: [Structural-Commands-and-Serialization.md](./Structural-Commands-and-Serialization.md)

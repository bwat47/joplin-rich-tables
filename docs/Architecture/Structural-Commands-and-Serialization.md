# Structural Commands and Serialization

Table changes operate on a normalized `MarkdownTable`, then write canonical Markdown back to the main editor. This applies to row and column commands, alignment, sorting, clearing, and multi-cell clipboard edits.

## Command Flow

Named commands and toolbar actions resolve the current active cell through `tableContextField`, then pass a `StructuralTableCommand` to `runStructuralCommand.ts`. Navigation can enter the same runner with a command that includes its destination column. The shared command catalog defines names and labels used across the Joplin host and content script; command names also appear in saved Joplin keymaps.

`structuralCommandSemantics.ts` applies the command to the table model without depending on CodeMirror. It returns either a resulting table with the intended target cell or a whole-table deletion. `MarkdownTable` owns the underlying row, column, sort, clear, and alignment operations.

The runtime runner serializes a surviving table, replaces its source range when the text changed, and dispatches explicit intent to open the target cell. Whole-table deletion instead removes the source and clears the active cell. The structural edit signal describes the transaction; it does not choose which cell to reopen. Source-changing commands replace the table as a whole, so the widget is rebuilt from the new document state. See [Table-Runtime-Invariants.md](./Table-Runtime-Invariants.md) for active-cell and widget lifecycle rules.

## Clipboard and Table Creation

Multi-cell paste and selection removal enter through `cellSelectionClipboard.ts`. They resolve current table state, apply changes through the model, and serialize the resulting table. A pasted table fragment can expand the target table; clearing or cutting a selection can clear cell contents or remove rows, columns, or an empty whole table. Root-editor paste handling also routes table fragments into this flow when a nested cell editor is active.

Inserting a new table and pasting a standalone table use shared rewrite logic to place canonical table Markdown with the required blank-line separation. These paths attach an explicit request to open the intended cell after insertion.

## Canonical Markdown

`MarkdownTable` normalizes ragged input to a rectangular grid and serializes each row with pipe delimiters and one space around cell content. It writes alignment markers but does not pad columns for visual alignment. Serialization also reports cell offsets, letting commands place the selection and reopen the correct cell without reparsing their output.

Canonicalization happens at editing, paste, and command boundaries, not while building the read-only table index. Interactive entry into a noncanonical table can normalize it before opening a cell; lifecycle restoration does not rewrite it. See [Table-Parsing.md](./Table-Parsing.md) for syntax projection and table indexing.

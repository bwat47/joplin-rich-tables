# Structural Commands and Serialization

Command flow from user action to Markdown serialization, including non-structural clear/format commands that still re-serialize table text.

Multi-cell clipboard writes use the same parse -> mutate -> serialize pattern, but enter through
`tableWidget/cellSelectionClipboard.ts` rather than `tableCommands.ts`.

## Command Flow

```
User Action (keyboard/toolbar)
         ↓
    tableCommands.ts           ← Command registration & dispatch
         ↓
 tableTransactionHelpers.ts    ← Parse, mutate, serialize, dispatch
         ↓
     MarkdownTable.ts          ← Runtime model + structural operations
```

## Layers

### 1. Entry Point (`tableCommands.ts`)

- **Joplin Registration**: `richTables.insertRowBelow`, etc.
- **Active Cell Validation**: Checks before executing.
- **Target Cell Computation**: Determines cell to re-activate after mutation.

### 1b. Selection Clipboard Entry (`tableWidget/cellSelectionClipboard.ts`)

- Document-level `copy`/`cut`/`paste` capture handles selection-mode clipboard operations and any nested-editor paste flows that surface as real DOM paste events.
- `Ctrl+X` is selection-only: copy markdown fragment, then run the shared selection-removal rewrite and keep the resulting selection state.
- `Ctrl+V` is anchor-based: selection top-left wins; otherwise an active nested editor can supply the anchor cell.
- Valid pasted markdown table fragments may expand the target table with new body rows and columns.
- `Delete`/`Backspace` reuse the same selection-removal rewrite path without touching the clipboard.

Selection removal is resolved in this order:

- If the selected rectangle is not fully empty, clear the selected cells.
- If the selected rectangle is fully empty and spans all columns, delete those rows when doing so still leaves a valid table.
- If the selected rectangle is fully empty and spans all unified rows (header + body), delete those columns when doing so still leaves a valid table.
- If the selected rectangle is the entire table and every cell is empty, delete the whole table.
- When a structural row/column delete is blocked by table invariants, fall back to normal clear semantics.

When Joplin routes Cmd/Ctrl+V to the root editor instead of the nested editor, `nestedEditor/mainEditorGuard.ts`
upgrades the resulting root-editor `input.paste` transaction into the same table rewrite before the normal
single-cell sanitation path can flatten the fragment into text.

### 2. Transaction Helpers (`tableTransactionHelpers.ts`)

`runTableOperation()` orchestrates:

1. **Build Context**: Slice table text → `TableContext` (`MarkdownTable` + `cellRanges`).
2. **Mutate**: Call operation function.
3. **Short-circuit**: Exit on no-op.
4. **Serialize**: `table.serialize()` → Markdown.
5. **Compute Active Cell**: `computeActiveCellForTableText()`.
6. **Dispatch**: Replace table range, update active cell state.

`forceWidgetRebuild` dispatches `rebuildTableWidgetsEffect`.

### 3. Runtime Model (`MarkdownTable.ts`)

`MarkdownTable` owns:

- Parse + normalization of ragged inputs.
- Serialization to canonical plugin Markdown.
- Row operations with current header/body command semantics.
- Column insert/delete/swap/alignment updates.
- Clear row/column/table operations.
- Rectangle clear plus anchor-based fragment paste with optional row/column expansion.
- Selection-removal helpers for empty-rect detection and contiguous row/column deletion.

## Serialization

`MarkdownTable.serialize()` output:

- **Padding**: `| cell |` (one space each side).
- **No pretty-printing**: No column width alignment.
- **Alignment**: `:---` (left), `---:` (right), `:---:` (center), `---` (default).
- **Normalization**: Ragged tables padded to consistent column counts.

The same canonical serialization is also used at the interactive edit boundary: explicit user entry into a
non-canonical table rewrites that table first, then reopens the target cell against the rebuilt widget. Lifecycle
reopens used to restore editor state skip that rewrite so undo/redo does not get trapped re-normalizing the same table.

Clipboard table paste also serializes the whole table after mutation. Existing column alignments are preserved;
clipboard alignments are only applied to newly created columns.

## Rebuild Trigger

Structural edits dispatch `rebuildTableWidgetsEffect` → full table-decoration rebuild → widget destroyed/recreated → new nested editor at target cell.

Full table rebuild; no row/column DOM diffing.

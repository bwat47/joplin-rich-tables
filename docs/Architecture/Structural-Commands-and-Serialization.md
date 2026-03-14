# Structural Commands and Serialization

Command flow from user action to Markdown serialization, including non-structural clear/format commands that still re-serialize table text.

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

### 2. Transaction Helpers (`tableTransactionHelpers.ts`)

`runTableOperation()` orchestrates:

1. **Build Context**: Slice table text → `TableContext` (`MarkdownTable` + `cellRanges`).
2. **Mutate**: Call operation function.
3. **Short-circuit**: Exit on no-op unless the caller requested a format-only re-serialize.
4. **Serialize**: `table.serialize()` → Markdown.
5. **Compute Active Cell**: `computeActiveCellForTableText()`.
6. **Dispatch**: Replace table range, update active cell state.

`forceWidgetRebuild` dispatches `rebuildTableWidgetsEffect`. `serializeIfIdentity` is used by format-only flows that want canonical Markdown output without a structural mutation.

### 3. Runtime Model (`MarkdownTable.ts`)

`MarkdownTable` owns:

- Parse + normalization of ragged inputs.
- Serialization to canonical plugin Markdown.
- Row operations with current header/body command semantics.
- Column insert/delete/swap/alignment updates.
- Clear row/column/table operations.

## Serialization

`MarkdownTable.serialize()` output:

- **Padding**: `| cell |` (one space each side).
- **No pretty-printing**: No column width alignment.
- **Alignment**: `:---` (left), `---:` (right), `:---:` (center), `---` (default).
- **Normalization**: Ragged tables padded to consistent column counts.

The same canonical serialization is also used at the interactive edit boundary: explicit user entry into a
non-canonical table rewrites that table first, then reopens the target cell against the rebuilt widget. Lifecycle
reopens used to restore editor state skip that rewrite so undo/redo does not get trapped re-normalizing the same table.

## Rebuild Trigger

Structural edits dispatch `rebuildTableWidgetsEffect` → full table-decoration rebuild → widget destroyed/recreated → new nested editor at target cell.

Full table rebuild; no row/column DOM diffing.

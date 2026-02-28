# Structural Commands and Serialization

Command flow from user action to Markdown serialization, including non-structural clear/format commands that still re-serialize table text.

## Command Flow

```
User Action (keyboard/toolbar)
         ↓
    tableCommands.ts           ← Command registration & dispatch
         ↓
  tableCommandSemantics.ts     ← Active-cell-aware operation logic
         ↓
 tableTransactionHelpers.ts    ← Parse, mutate, serialize, dispatch
         ↓
markdownTableManipulation.ts   ← Pure TableData transformations
```

## Layers

### 1. Entry Point (`tableCommands.ts`)

- **Joplin Registration**: `richTables.insertRowBelow`, etc.
- **Active Cell Validation**: Checks before executing.
- **Target Cell Computation**: Determines cell to re-activate after mutation.

### 2. Semantics (`tableCommandSemantics.ts`)

Active-cell-aware wrappers with header-row constraints:

- **Insert before header**: Creates empty header; old header becomes first body row.
- **Insert after header**: Inserts body row at index 0.
- **Delete header**: Promotes first body row (blocked if only one body row).
- **Move header up**: No-op.

### 3. Transaction Helpers (`tableTransactionHelpers.ts`)

`runTableOperation()` orchestrates:

1. **Parse**: Slice table text → `TableData`.
2. **Mutate**: Call operation function.
3. **Short-circuit**: Identity check; no changes if same object returned.
4. **Serialize**: `serializeTable()` → Markdown.
5. **Compute Active Cell**: `computeActiveCellForTableText()`.
6. **Dispatch**: Replace table range, update active cell state.

`forceWidgetRebuild` dispatches `rebuildTableWidgetsEffect`.

### 4. Manipulation (`markdownTableManipulation.ts`)

| Function                                        | Purpose                                |
| ----------------------------------------------- | -------------------------------------- |
| `insertRow(table, rowIndex, where)`             | Insert empty row before/after          |
| `deleteRow(table, rowIndex)`                    | Remove row (blocked if last body row)  |
| `insertColumn(table, colIndex, where)`          | Insert empty column before/after       |
| `deleteColumn(table, colIndex)`                 | Remove column (blocked if last column) |
| `swapRows(table, row1, row2)`                   | Swap rows (move up/down)               |
| `swapColumns(table, col1, col2)`                | Swap columns (move left/right)         |
| `updateColumnAlignment(table, colIndex, align)` | Set column alignment                   |
| `clearRow(table, section, rowIndex)`            | Clear all cells in one row             |
| `clearColumn(table, colIndex)`                  | Clear all cells in one column          |
| `clearAllCells(table)`                          | Clear every cell in table              |
| `serializeTable(table)`                         | Convert to Markdown                    |

## Serialization

`serializeTable()` output:

- **Padding**: `| cell |` (one space each side).
- **No pretty-printing**: No column width alignment.
- **Alignment**: `:---` (left), `---:` (right), `:---:` (center), `---` (default).
- **Normalization**: Ragged tables padded to consistent column counts.

## Rebuild Trigger

Structural edits dispatch `rebuildTableWidgetsEffect` → `rebuildSingleTable()` → widget destroyed/recreated → new nested editor at target cell.

Full table rebuild; no row/column DOM diffing.

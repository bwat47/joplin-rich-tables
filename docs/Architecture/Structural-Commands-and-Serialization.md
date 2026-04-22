# Structural Commands and Serialization

Command flow from user action to Markdown serialization, including non-structural clear/format commands that still re-serialize table text.

Multi-cell clipboard writes use the same parse -> mutate -> serialize pattern, but enter through
`tableRuntime/selection/cellSelectionClipboard.ts` rather than `tableCommands.ts`.

## Command Flow

```
User Action (keyboard/toolbar)
         ↓
    tableCommands.ts           ← Command registration only
         ↓
   operations/tableOperations.ts   ← Runtime entry points
         ↓
   operations/runTableOperation.ts ← Parse, mutate, serialize, dispatch
         ↓
     MarkdownTable.ts          ← Runtime model + structural operations
```

## Layers

### 1. Entry Point (`tableCommands.ts`)

- **Joplin Registration**: `richTables.insertRowBelow`, etc.
- **Active Cell Validation**: Checks before executing.
- **Delegation Only**: Dispatches into `tableRuntime/operations/tableOperations.ts`.

### 1b. Selection Clipboard Entry (`tableRuntime/selection/cellSelectionClipboard.ts`)

- Document-level `copy`/`cut`/`paste` capture handles selection-mode clipboard operations and any nested-editor paste flows that surface as real DOM paste events.
- `Ctrl+X` is selection-only: copy markdown fragment, then run the shared selection-removal rewrite and keep the resulting selection state.
- `Ctrl+V` is anchor-based: selection top-left wins; otherwise an active nested editor can supply the anchor cell.
- Valid pasted markdown table fragments may expand the target table with new body rows and columns.
- `Delete`/`Backspace` reuse the same selection-removal rewrite path without touching the clipboard.

Selection removal is resolved in this order:

- If the selected rectangle is not fully empty, clear the selected cells.
- If the selected rectangle is fully empty and spans all columns, delete those rows when doing so still leaves at least one row in the table. Header-only tables are valid.
- If the selected rectangle is fully empty and spans all unified rows (header + body), delete those columns when doing so still leaves a valid table.
- If the selected rectangle is the entire table and every cell is empty, delete the whole table.
- When a structural row/column delete is blocked by table invariants, fall back to normal clear semantics.

When Joplin routes Cmd/Ctrl+V to the root editor instead of the nested editor, `editorBridge/mainEditorGuard.ts`
has two `input.paste` upgrade paths:

- With a nested editor open, it upgrades valid markdown table fragments into the same multi-cell table rewrite before the normal single-cell sanitation path can flatten the fragment into text.
- With no nested editor or cell selection active, it can normalize a pasted standalone markdown table at a block boundary into canonical table markdown, preserve required blank-line separation, and schedule activation of header cell `(0,0)`.

The explicit "insert table" command reuses the same isolated root-table insertion rewrite for block-boundary
insertions, so paste and command creation share the same blank-line separation rules. Mid-line command
insertion still falls back to the legacy direct insert path because the paste rewrite intentionally does not
define paragraph-splitting behavior.

### 2. Runtime Mutation Helpers (`tableRuntime/operations/runTableOperation.ts`)

`runTableOperation.ts` has one shared preparation core that orchestrates:

1. **Build Context**: Slice table text → `TableContext` (`MarkdownTable` + `cellRanges`).
2. **Mutate**: Call operation function.
3. **Short-circuit**: Exit on no-op.
4. **Serialize**: `table.serialize()` → Markdown.
5. **Compute Active Cell**: `tableRuntime/activeCell/activeCellFactory.ts`.
6. **Dispatch**:
   - `runTableOperation()` replaces the table range and updates active-cell state.
   - `runTableOperationAndOpen()` does the same work, then also sets the main-editor selection,
     registers pending open/focus state, dispatches `requestOpenActiveCellEffect`, and forces a widget rebuild.

`forceWidgetRebuild` dispatches `rebuildTableWidgetsEffect`.

Row insertion uses `runTableOperationAndOpen()` for every entry path: toolbar commands, command palette actions,
and keyboard-created rows from Enter/Tab at the end of the table. That means row creation no longer relies on
lifecycle inferring reopen intent from a rebuild-only transaction.

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

Most structural edits still dispatch `rebuildTableWidgetsEffect` from `tableState/tableWidgetEffects.ts` → full
table-decoration rebuild → widget destroyed/recreated → new nested editor at target cell.

Row insertion is the exception in this pass: it dispatches both `rebuildTableWidgetsEffect` and an explicit
open request, so lifecycle follows the open-request path instead of the generic rebuild fallback.

Full table rebuild; no row/column DOM diffing.

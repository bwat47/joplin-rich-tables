# Structural Commands and Serialization

Command flow from user action to Markdown serialization, including non-structural clear/format commands that still re-serialize table text.

Multi-cell clipboard writes use the same parse -> mutate -> serialize pattern, but enter through
`tableRuntime/selection/cellSelectionClipboard.ts` rather than `tableCommands.ts`.

## Command Flow

```
User Action (keyboard/toolbar)
         ↓
    tableCommands.ts / tableToolbarPlugin.ts ← Resolve active cell once
         ↓
   operations/structuralActions.ts      ← Shared action-to-command adapter
          ↓
   operations/structuralOperations.ts   ← Run StructuralTableCommand + reopen defaults
            ↓
     operations/runStructuralMutation.ts ← Prepares and Dispatches surviving-table or table-deletion results
           ↓
      tableModel/structuralCommandSemantics.ts ← Apply command, return surviving table or table deletion
           ↓
      MarkdownTable.ts          ← Runtime model + structural operations
```

## Layers

### 1. Entry Point (`tableCommands.ts`)

- **Joplin Registration**: `richTables.insertRowBelow`, etc.
- **Active Cell Resolution**: Resolves the current active cell once with `getResolvedActiveCell()`.
- **Delegation Only**: Dispatches through the shared structural action registry.

The floating toolbar follows the same action path. It keeps plain `ActiveCell` state for visibility and positioning,
but resolves fresh from the current editor state when a toolbar button is clicked so async toolbar layout work does
not preserve stale table context.

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

- With a nested editor open, if the pasted text is a valid markdown table fragment it is intercepted and routed through `buildMultiCellPasteRewrite` (using the active cell as the anchor) — the same path as Ctrl+V in selection mode. Without this interception the guard's normal sanitization path would treat the fragment as plain text and paste it into the single active cell.
- With no nested editor or cell selection active, it can normalize a pasted standalone markdown table at a block boundary into canonical table markdown, preserve required blank-line separation, and schedule activation of header cell `(0,0)`.

The explicit "insert table" command always uses `buildRootTableInsertRewrite` directly, regardless of cursor
position — it handles blank-line padding for both block-boundary and mid-line cases. The paste normalizer
tries `buildIsolatedRootTableInsertRewrite` first (returns null if the cursor is not at a block boundary) and
falls back to `buildRootTableInsertRewrite`, so both paths share the same blank-line separation rules.

### 2. Runtime Mutation Helpers (`tableRuntime/operations/runStructuralMutation.ts`)

`runStructuralMutation.ts` has one shared preparation core that receives a `ResolvedActiveCell` plus a
`StructuralTableCommand` and orchestrates:

1. **Use Resolved Context**: Reuse the resolved table span, `TableContext`, and logical active cell.
2. **Apply Command Semantics**: Call `structuralCommandSemantics.ts` to obtain `{ table, targetCell }`.
3. **Short-circuit**: Exit on no-op.
4. **Serialize**: `table.serialize()` → Markdown.
5. **Compute Active Cell**: `tableRuntime/activeCell/activeCellFactory.ts`.
6. **Dispatch**: `runStructuralMutationAndReopen()` replaces the table range when needed, sets the
   main-editor selection, registers an explicit open-cell request, dispatches its id-only open signal,
   forces a widget rebuild, and can run an immediate post-dispatch callback such as main-editor focus handoff.

`structuralActions.ts` maps shared action IDs to canonical `StructuralTableCommand` objects so keyboard commands and
toolbar buttons do not maintain separate switchboards.

`structuralCommandSemantics.ts` owns editor-independent command semantics:

- It maps table-local command IDs plus active cell coordinates to either a new `MarkdownTable` plus target-cell intent,
  or a table-deletion result.
- It does not import CodeMirror or runtime state.

`structuralOperations.ts` is the runtime adapter on top of the runner:

- It applies shared reopen defaults for canonical `StructuralTableCommand` objects.
- It owns shared reopen defaults such as main-editor focus handoff.
- Row-insert helpers extend those defaults with `initialCursorPos: 'start'`.
- It passes command objects to `runStructuralMutationAndReopen()`; callers cannot provide arbitrary mutation callbacks.

All surviving-table structural mutations use `runStructuralMutationAndReopen()`: row/column insert,
delete, move, clear, and alignment updates. Whole-table deletion uses the same runner but clears active-cell state
instead of reopening a cell. That means command-driven structural edits don't rely on lifecycle
inferring reopen intent from a rebuild-only transaction. Reopen intent is explicit: if a transition should reopen,
it must dispatch an open-cell request alongside the rebuild.

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

Command-driven structural mutations dispatch both `rebuildTableWidgetsEffect` and an explicit open request, so
lifecycle follows the open-request path. Rebuild-only transitions do not implicitly reopen a nested editor.

Full table rebuild; no row/column DOM diffing.

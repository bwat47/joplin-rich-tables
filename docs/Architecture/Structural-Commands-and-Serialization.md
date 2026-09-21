# Structural Commands and Serialization

Command flow from user action to Markdown serialization, including non-structural clear, format, and sort commands that still re-serialize table text.

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

- **Joplin Registration**: derived from `contentScriptBridge/structuralCommandCatalog.ts`, the shared source of
  truth for structural command names, labels, and menu accelerators. The host (`src/index.ts`) builds its command
  and menu registrations from the same catalog, so the two sides cannot drift across the bundle boundary.
  Catalog keys are `StructuralActionId`s, so a new action fails to compile until it has a command. Command names
  are persisted in the user's Joplin keymap - renaming one orphans their custom shortcut.
- **Active Cell Resolution**: Resolves the current active cell once with `getResolvedActiveCell()`.
- **Delegation Only**: Dispatches through the shared structural action registry.

The floating toolbar follows the same action path. It keeps plain `ActiveCell` state for visibility and positioning,
but resolves fresh from the current editor state when a toolbar button is clicked so async toolbar layout work does
not preserve stale table context.

### 1b. Selection Clipboard Entry (`tableRuntime/selection/cellSelectionClipboard.ts`)

- Document-level `copy`/`cut`/`paste` capture handles selection-mode clipboard operations and any nested-editor paste flows that surface as real DOM paste events.
- A `paste` handler on the nested editor itself is the fallback for a paste the document-level capture declined; it fires only when that capture left the event unhandled, and non-table text falls through to CodeMirror's own paste handling.
- Rewrites carry `tableClipboardRewriteAnnotation` so the main-editor guard lets them through instead of rejecting them for reaching outside the active cell.
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
- With no nested editor or cell selection active, it can normalize a pasted standalone markdown table at a block boundary into canonical table markdown, preserve required blank-line separation, and attach an open-cell request for header cell `(0,0)` to the paste transaction.

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
   marks the transaction with `structuralTableEditEffect`, and restores main-editor focus after a successful dispatch.

`structuralActions.ts` maps shared action IDs to canonical `StructuralTableCommand` objects so keyboard commands and
toolbar buttons do not maintain separate switchboards.

`structuralCommandSemantics.ts` owns editor-independent command semantics:

- It maps table-local command IDs plus active cell coordinates to either a new `MarkdownTable` plus target-cell intent,
  or a table-deletion result.
- It does not import CodeMirror or runtime state.

`structuralOperations.ts` is the runtime adapter on top of the runner:

- It forwards canonical `StructuralTableCommand` objects to `runStructuralMutationAndReopen()`.
- Row-insert commands reopen with `initialCursorPos: 'start'`; other commands omit it and mirror the main selection.
- The runner owns focus handoff and suppresses navigation keys until every surviving-table reopen settles.

All surviving-table structural mutations use `runStructuralMutationAndReopen()`: row/column insert,
delete, move, clear, and alignment updates. Whole-table deletion uses the same runner but clears active-cell state
instead of reopening a cell. That means command-driven structural edits don't rely on lifecycle
inferring reopen intent from the structural-edit signal. Reopen intent is explicit: if a transition should reopen,
it must dispatch an open-cell request alongside the signal.

### 3. Runtime Model (`MarkdownTable.ts`)

`MarkdownTable` owns:

- Parse + normalization of ragged inputs.
- Serialization to canonical plugin Markdown.
- Row operations with current header/body command semantics.
- Column insert/delete/swap/alignment updates.
- Stable body-row sorting by a selected column's raw Markdown.
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

## Column Sorting

Ascending and descending sorts keep the header fixed and reorder complete body rows. Comparison uses the raw,
trimmed cell content stored by `MarkdownTable`, without rendering or stripping Markdown. An `Intl.Collator` with
numeric comparison and base sensitivity provides natural digit ordering and case-insensitive equality. Blank cells
remain last in both directions, equal values keep their original order, and the active body row follows its original
row to the sorted position.

## Structural Edit Signal

Command-driven structural mutations dispatch both `structuralTableEditEffect` and an explicit open request, so
lifecycle follows the open-request path. A structural-edit signal alone does not implicitly reopen a nested editor.

Source-changing structural edits replace the whole table range, so decoration reconciliation renders a fresh widget;
there is no row/column DOM diffing. See `tableState/structuralTableEditEffect.ts` for what the signal does and does not
guarantee, and which modules read it.

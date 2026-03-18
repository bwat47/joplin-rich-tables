# Nested Editor Architecture

In-cell editing uses a transient CodeMirror instance inside the active `<td>`.

## Concept

Overlay a real editor rather than using contenteditable (for full syntax highlighting, better multi-line handling, better integration/synchronization with the main editor).

- **Scope**: Contains only the active cell text in isolated local coordinates.
- **Effect**: User edits a true cell-local editor while the root document remains authoritative.

## Lifecycle

Managed by `contentScript/tableRuntime/nestedEditorLifecycle.ts`.

**Activation**: Cell click/keyboard activation resolves the target cell from widget DOM + `TableContext`/cell ranges → `setActiveCellEffect` dispatched → lifecycle plugin mounts the nested editor.

`setActiveCellEffect` stores logical cell identity plus an anchor position inside the table. The lifecycle plugin resolves raw
table/cell offsets from current editor state immediately before opening the isolated editor. Ongoing sync is handled by `nestedEditor/activeCellSession.ts`.

**Mounting**: `ensureSyntaxTree` (with timeout) prevents FOUC → editor mounted into `<td>` → focus transferred.

**Deactivation**: Click outside, note switch, or Source Mode toggle → `clearActiveCellEffect` dispatched → view plugin destroys instance.

Lifecycle, decoration, and main-editor guard reactions share one transition-policy module
(`contentScript/tableRuntime/tableRuntimeTransitions.ts`). That module decides when to reopen,
remap, rebuild, sanitize, or clear state; the lifecycle plugin remains responsible only for
executing nested-editor side effects.

## Synchronization

### Edit Sync Cycle

1. User types in the isolated editor.
2. `ActiveCellSession` uses `editorBridge/cellTextCodec.ts` to sanitize local display text (`\n` -> `<br>`, `|` -> `\|`) and map the local selection into root cell coordinates.
3. The main editor applies the cell-only replacement transaction tagged with `editorBridge/syncAnnotation.ts`.
4. After root dispatch, the session refreshes its derived absolute ranges from the mapped anchor position.
5. External non-sync root changes re-resolve the logical cell and rebase the isolated editor from authoritative root text.

### Selection Sync

Joplin toolbar reads main editor selection, so nested must mirror upward.

1. `ActiveCellSession` watches local selection changes.
2. It mirrors the mapped absolute selection to the main editor (`syncAnnotation` + `addToHistory: false`).
3. Root-owned commands update the authoritative root selection/doc.
4. The session rebases the isolated editor selection from the resulting root cell text.

### Undo/Redo

**Main editor owns history.** Nested editor uses `addToHistory: false`.

- `Ctrl+Z/Y/Shift+Z` intercepted → forwarded to main editor.
- Undo to different cell → nested editor closes, new one opens.
- Undo outside table → nested editor closes, main gains focus.

### Full Document Replacement (Sync)

Joplin sync replaces entire document. Detected by `isFullDocumentReplace()` (single change spanning `[0, doc.length]`).

Response (to prevent stale document state):

1. `mainEditorGuard` dispatches `clearActiveCellEffect`.
2. `tableDecorationField` returns `Decoration.none` during replacement.
3. `rebuildAllTableWidgetsEffect` scheduled via `requestAnimationFrame`.

## Boundary Enforcement

### Editor Bridge (`cellTextCodec`, `syncAnnotation`)

- **Local → Root Sanitization**: `\n`/`\r` → `<br>`, `|` → `\|`.
- **Root → Local Unsanitization**: `<br>` → visible line breaks, `\|` → `|`.
- **Selection Mapping**: Local/root selections are mapped through the sanitize/unsanitize transforms, not by naive offset arithmetic.

### Main Editor (`editorBridge/mainEditorGuard`)

Blocks unintended main editor edits during cell editing (Android IME focus issues where focus can jump to main editor).

- Uses the shared transition policy to allow, reject, or sanitize main-editor transactions.
- Rejects changes touching active table but outside cell range.
- Allows external updates not overlapping table.
- Whitelists `syncAnnotation` transactions.
- Whitelists structural operations with `rebuildTableWidgetsEffect`.
- Sanitizes context-menu paste (newlines → `<br>`, pipes escaped).
- Upgrades root-editor `input.paste` transactions into multi-cell table paste when Joplin routes Cmd/Ctrl+V to the main editor while a nested editor is open.
- Also upgrades plain root-editor `input.paste` of a standalone markdown table at a block boundary into canonical table markdown plus deferred cell activation when no nested editor or cell selection is active.
- Clears stale active-cell state if logical resolution can no longer find the anchored table/cell from the mapped anchor position.

## Styling

Nested editor requires its own extensions for parity with main editor:

- **GFM**: GitHub Flavored Markdown enabled.
- **Inline Code**: Styled border around backticked code.
- **Mark**: `==text==` highlighting.
- **Insert**: `++text++` underline.

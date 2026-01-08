# Nested Editor Architecture

In-cell editing uses a transient CodeMirror instance inside the active `<td>`.

## Concept

Overlay a real editor rather than using contenteditable (avoids browser inconsistencies).

- **Scope**: Contains full document but clips view to active cell range only.
- **Effect**: User edits a viewport of a second editor synced to the first.

## Lifecycle

Managed by `contentScript/tableWidget/nestedEditorLifecycle.ts`.

**Activation**: Cell click → `TableWidget` calculates range → `setActiveCellEffect` dispatched → lifecycle plugin mounts `NestedEditor`.

**Mounting**: `ensureSyntaxTree` (with timeout) prevents FOUC → editor mounted into `<td>` → focus transferred.

**Deactivation**: Click outside, note switch, or Source Mode toggle → `clearActiveCellEffect` dispatched → view plugin destroys instance.

## Synchronization

### Edit Sync Cycle

1. User types → `forwardChangesToMain` captures transaction.
2. Creates corresponding main editor transaction tagged with `syncAnnotation`.
3. Main editor applies transaction.
4. `nestedEditorLifecyclePlugin` checks for `syncAnnotation`:
    - **Present**: Ignores (came from nested editor).
    - **Absent**: External change → `applyMainTransactionsToNestedEditor` pushes down to nested editor.

### Selection Sync

Joplin toolbar reads main editor selection, so nested must mirror upward.

1. `forwardSelectionToMain` watches nested selection.
2. Dispatches matching selection to main (with `syncAnnotation` + `addToHistory: false`).
3. Main can also push selection down to nested editor after Joplin-native commands.

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

### Nested Editor (`transactionPolicy`)

- **Range Filter**: Rejects edits outside `[cellFrom, cellTo]`.
- **Newline Conversion**: `\n`/`\r` → `<br>` tags.
- **Pipe Escaping**: `|` → `\|`.

### Main Editor (`mainEditorGuard`)

Blocks unintended main editor edits during cell editing (Android IME focus issues where focus can jump to main editor).

- Rejects changes touching active table but outside cell range.
- Allows external updates not overlapping table.
- Whitelists `syncAnnotation` transactions.
- Whitelists structural operations with `rebuildTableWidgetsEffect`.
- Sanitizes context-menu paste (newlines → `<br>`, pipes escaped).

## Styling

Nested editor requires its own extensions for parity with main editor:

- **GFM**: GitHub Flavored Markdown enabled.
- **Inline Code**: Styled border around backticked code.
- **Mark**: `==text==` highlighting.
- **Insert**: `++text++` underline.

# Nested Editor Architecture

In-cell editing uses a transient CodeMirror instance inside the active `<td>`.

The decision to use a nested CodeMirror editor instead of `contenteditable` is covered in [ADR-002](../ADR/002-nested-codemirror-subview.md). The decision to keep the editor cell-local and live-patch the main document is covered in [ADR-003](../ADR/003-cell-local-nested-editor.md) and [ADR-005](../ADR/005-live-patch-nested-editing.md).

## Model

- **Scope**: Contains only the active cell text in isolated local coordinates.
- **Effect**: User edits a true cell-local editor while the root document remains authoritative.

## Lifecycle

Managed by `contentScript/tableRuntime/lifecycle/nestedEditorLifecycle.ts`.

**Activation**: Cell click/keyboard activation resolves the target cell from widget DOM + `TableContext`/cell ranges into
`ResolvedActiveCell` → `setActiveCellEffect` plus an open-intent effect dispatched → lifecycle plugin mounts the nested editor.

`setActiveCellEffect` stores stable logical cell identity: `tableFrom` plus `section/row/col`. Any cursor placement for
opening is passed separately as transient selection-anchor data. The lifecycle plugin resolves raw table/cell offsets from
current editor state immediately before opening the isolated editor. Ongoing mount/sync/close behavior is handled by
`nestedEditor/nestedEditorController.ts`.

Entry transactions carry any canonical-form repair the table needs (`tableRuntime/tableCanonicalForm.ts`), so the whole
entry is one document change belonging to the event that asked for it. Repairing a frame later instead reaches the host
as an update it cannot order against the surrounding keystrokes, and Joplin writes a stale note body back over the
editor — which tears down the nested editor.

Mounting: ensureSyntaxTree (with timeout) prevents FOUC → editor mounted into `<td>` → focus transferred.

**Deactivation**: Click outside, note switch, or Source Mode toggle → `clearActiveCellEffect` dispatched → lifecycle plugin destroys the instance.

Policy is split by concern:

- `tableRuntime/lifecycle/runtimeEventClassifier.ts` adapts CodeMirror updates into compact runtime facts by scanning
  transactions, resolving active-cell geometry, checking table ranges, and classifying raw-mode/open-request/sync
  conditions.
- `tableRuntime/lifecycle/lifecyclePolicy.ts` reduces those facts into ordered lifecycle actions. It owns action
  precedence, including explicit open-request priority, and does not consume `ViewUpdate`, transactions, resolved
  geometry, or table scans.
- `tableRuntime/lifecycle/nestedEditorLifecycle.ts` stores plugin-local previous-state flags, calls the classifier and
  reducer, maps fallback hints, and executes the planned CodeMirror/nested-editor side effects. Execution-time guards
  revalidate delayed open requests before touching DOM or mounting the nested editor.
- `editorBridge/mainEditorGuardPolicy.ts` decides whether main-editor transactions are allowed, rewritten, or sanitized.
- `tableWidget/tableDecorationPolicy.ts` decides whether table decorations are kept, mapped, removed, or rebuilt.

The lifecycle classifier owns CodeMirror adaptation, the lifecycle policy owns action ordering and precedence, and the
lifecycle plugin owns nested-editor side effects.

## Synchronization

### Edit Sync Cycle

1. User types in the isolated editor.
2. `NestedEditorSession` uses `editorBridge/cellTextCodec.ts` to sanitize local display text (`\n` -> `<br>`, `|` -> `\|`) and map the local selection into root cell coordinates.
3. The main editor applies the cell-only replacement transaction tagged with `editorBridge/syncAnnotation.ts`.
4. After root dispatch, the session refreshes its `ResolvedActiveCell` from the current active-cell identity.
5. External non-sync root changes re-resolve the logical cell and rebase the isolated editor from authoritative root text.

### Selection Sync

Joplin toolbar reads main editor selection, so nested must mirror upward.

1. `NestedEditorSession` watches local selection changes.
2. It mirrors the mapped absolute selection to the main editor (`syncAnnotation` + `addToHistory: false`).
3. Root-owned commands update the authoritative root selection/doc.
4. The session rebases the isolated editor selection from the resulting root cell text.

Selection mirroring uses the cell's editable span, not the fully trimmed semantic content span. This keeps toolbar and
formatting commands aligned with user-entered leading/trailing whitespace while still hiding canonical delimiter padding
from the local editor.

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
- Treats the editable span as the allowed in-cell edit range while the semantic span remains the render/parse source.
- Allows external updates not overlapping table.
- Whitelists `syncAnnotation` transactions.
- Whitelists structural operations with `rebuildTableWidgetsEffect`.
- Sanitizes context-menu paste (newlines → `<br>`, pipes escaped).
- Upgrades root-editor `input.paste` transactions into multi-cell table paste when Joplin routes Cmd/Ctrl+V to the main editor while a nested editor is open.
- Also upgrades plain root-editor `input.paste` of a standalone markdown table at a block boundary into canonical table markdown plus deferred cell activation when no nested editor or cell selection is active.
- Clears stale active-cell state if logical resolution can no longer find the anchored table/cell from the persisted active-cell identity.

## Styling

Nested editor requires its own extensions for parity with main editor:

- **Markdown parsing**: GFM-derived inline parsing enabled, but block-level parsers (headings, lists, blockquotes, fenced code, tables, task lists, etc.) are removed so cell editing matches inline-only cell rendering.
- **Inline Code**: Styled border around backticked code.
- **Mark**: `==text==` highlighting.
- **Insert**: `++text++` underline.
- **Editor Features**: Close-bracket behavior and native spellcheck are sourced from a one-time
  content-script-startup snapshot of the Joplin `editor.autoMatchingBraces` and `spellChecker.enabled` settings
  fetched through the plugin process. Spellcheck adds a `spellcheck="true"` content attribute to the nested editor.

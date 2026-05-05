# Table Runtime Invariants

The table runtime behaves like a cross-file state machine. These invariants define the rules that must stay true across active-cell state, widget decorations, nested editing, structural commands, selection, and focus handling.

## Source of Truth

- The main CodeMirror document is the only authoritative table state.
- `MarkdownTable`, `TableContext`, and cell ranges are derived from current document text.
- Widget DOM is a projection of document state. It must not be used as durable table state.
- Nested editor text is temporary local state for one active cell. It must be synchronized back to the main document before commands depend on it.

## Active Cell Identity

- `ActiveCell` is logical identity: table start position, section, row, column, and selection anchor intent.
- `ResolvedActiveCell` is a derived lookup against the current document. Treat it as disposable after document changes.
- Runtime code must re-resolve an active cell before using document offsets such as editable cell bounds.
- If the active cell can no longer resolve after a non-sync document change, clear it instead of keeping stale positions.

## Cell Bounds

- Semantic cell bounds and editable text bounds are not interchangeable.
- Semantic bounds identify the Markdown cell span, including delimiters and padding.
- Editable bounds identify the user-editable cell content.
- Cross-editor selection conversion must use editable bounds and `cellTextCodec` helpers.
- Structural table commands must operate on the parsed table model, not on nested editor DOM.

## Sync Transactions

- Any transaction forwarding changes between the main editor and nested editor must carry `syncAnnotation`.
- Sync transactions must not trigger another mirrored sync pass.
- Nested-editor local transactions should not create independent undo history for mirrored main-document edits.
- Runtime logic must distinguish user edits from sync edits before deciding to close, reopen, rebuild, or clear active-cell state.

## Explicit Cell Opening

- Cell opening is explicit whenever the initiating action knows the intended destination.
- Mouse activation, keyboard navigation, inserted-table activation, and structural commands should emit a durable open request for the exact target cell.
- Structural commands that create or move cells must precompute the post-mutation target cell instead of relying on lifecycle inference.
- Explicit open requests take priority over generic lifecycle reactions such as close, clear, reposition, or cursor restoration.
- Lifecycle inference is only a fallback for cases without a command-level destination, such as source-mode exit or undo/redo repositioning.

## Widget Rebuilds

- Decoration policy owns only the table projection decision: keep, map, rebuild, or hide widgets.
- Widget rebuilds can invalidate DOM references and focus assumptions.
- Code that needs an editor to remain active across a rebuild must express that as open intent, not by assuming DOM continuity.
- `TableWidget` may reuse DOM for equivalent content, but runtime correctness must not depend on DOM reuse.
- Block decorations must remain provided by `StateField`, not `ViewPlugin`.

## Focus and Editing Ownership

- While a nested editor is open, it owns text input for the active cell.
- Main-editor guards must prevent edits that would corrupt the active cell or create sync loops.
- Focus changes alone are not reliable lifecycle signals. Use explicit requests, transaction annotations, and resolved active-cell state.
- Mobile IME stability depends on avoiding unnecessary close/reopen gaps. Explicit open requests should be executed as one open path when switching or creating cells.

## Raw Source Mode

- Source/search raw mode owns table display while active.
- Entering raw mode must not leave a nested editor mounted over hidden or source-rendered table text.
- Exiting raw mode may reactivate a cell at the cursor, but only through the lifecycle fallback path unless an explicit open request exists.
- Selection changes caused by source-mode transitions must be filtered separately from normal table-selection changes.

## Selection and Clipboard

- Cell selection state is logical table state, not DOM selection.
- Clipboard extraction and paste rewrites must resolve against current `TableContext`.
- Selection transitions must be annotated so lifecycle logic does not treat them as ordinary cursor movement outside the table.
- Pasting over a selected range should produce one table rewrite and one explicit post-rewrite selection or open intent.

## Lifecycle Policy Boundary

- Edge modules should report facts or intents; lifecycle policy decides consequences.
- Interaction handlers may identify requested targets and input source, but should not decide rebuild, close, sync, or stale-state cleanup behavior.
- Open-cell request code should carry durable target, reason, and focus-continuity requirements without spreading timing policy.
- Decoration policy should not infer activation.
- The impure executor may dispatch effects, schedule animation frames, open/close nested editors, and scroll. It should not invent new lifecycle decisions.

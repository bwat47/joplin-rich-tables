# Nested Editor Architecture

Editing a cell mounts a temporary CodeMirror editor inside that cell's widget. It contains only the active cell's text; the main editor document remains authoritative for table content, selection, and undo history. See [ADR-002](../ADR/002-nested-codemirror-subview.md), [ADR-003](../ADR/003-cell-local-nested-editor.md), and [ADR-005](../ADR/005-live-patch-nested-editing.md) for the design decisions.

## Lifecycle

Cell activation records a logical table and cell identity plus an explicit request to open it. `nestedEditorLifecycle.ts` resolves that identity against the current `tableContextField` index before mounting or updating the nested editor. `nestedEditorController.ts` owns the CodeMirror instance, focus handoff, synchronization, and cleanup. When editing ends, the cell returns to rendered Markdown.

The lifecycle separates facts, decisions, and effects: `runtimeEventClassifier.ts` describes editor updates, `lifecyclePolicy.ts` decides whether to open, update, or close, and the lifecycle plugin executes that decision. A note switch takes priority over every other path. Otherwise an explicit open request takes priority over close, sync, and reposition decisions. Document changes can invalidate a widget or cell position, so delayed work rechecks current state rather than trusting saved DOM or offsets. Entry-time table normalization is included in the activating transaction.

Leaving a table, entering raw source mode, or switching notes closes the nested editor. A note switch does not reopen a cell in the new note. Undo, redo, and other root-editor changes use the current table index to update or close the session as needed. The [runtime invariants](./Table-Runtime-Invariants.md) describe those cross-module rules.

## Live Synchronization

Local edits are converted to valid single-cell Markdown and written immediately into the main document. `cellTextNormalization.ts` converts visible line breaks and pipes to their stored form; `cellTextCodec.ts` maps selections between local coordinates and the cell's editable range in the root document. Selection changes are mirrored upward so root-owned commands and Joplin's toolbar see the current caret.

Changes from the main editor rebase the nested editor from authoritative document text and selection. Both directions mark forwarded transactions with `syncAnnotation` to prevent feedback loops. The nested editor does not keep independent undo history; undo and redo act on the main document.

`mainEditorGuard` protects the active table while the nested editor owns cell input. It allows coordinated sync, structural, and clipboard rewrites, permits unrelated changes outside the table, and rejects or sanitizes root-editor edits that would corrupt the active cell or its boundaries.

## Cell Editing Features

The nested editor parses inline Markdown without enabling block constructs that would conflict with table cells. Its styling and editing extensions support inline formatting, wrapping, bracket completion, and host spellcheck settings while keeping the cell's rendered and editable views consistent.

This document is for LLM context. Be concise.

# Rich Tables Plugin

Joplin plugin that renders Markdown tables as interactive HTML tables in CodeMirror 6, with in-cell editing via nested editors.

## Core Components

| Directory/File                            | Purpose                                                        |
| ----------------------------------------- | -------------------------------------------------------------- |
| `tableWidget/tableWidgetExtension.ts`     | Main wiring: plugins, styles, commands                         |
| `tableWidget/TableWidget.ts`              | Table HTML rendering, click-to-cell mapping, height estimation |
| `tableWidget/nestedEditorLifecycle.ts`    | Nested editor lifecycle (open/close/sync)                      |
| `tableWidget/activeCellState.ts`          | Tracks active cell in main editor state                        |
| `tableWidget/tableNavigation.ts`          | Tab/Enter/Arrow navigation                                     |
| `tableWidget/sourceMode.ts`               | Source mode toggle (raw markdown)                              |
| `tableWidget/searchForceSourceMode.ts`    | Forces source mode while search panel open                     |
| `nestedEditor/nestedCellEditor.ts`        | Nested editor creation and sync logic                          |
| `nestedEditor/transactionPolicy.ts`       | Cell boundary enforcement, pipe/newline handling               |
| `nestedEditor/mainEditorGuard.ts`         | Blocks main-editor edits outside active cell (Android defense) |
| `tableCommands/tableCommands.ts`          | Structural commands (insert/delete/move row/col)               |
| `tableModel/markdownTableManipulation.ts` | Pure table data transformations, serialization                 |
| `services/markdownRenderer.ts`            | Async cell content rendering with FIFO cache                   |
| `services/documentDefinitions.ts`         | Reference link definition extraction for context injection     |
| `toolbar/tableToolbarPlugin.ts`           | Floating toolbar (positioned via @floating-ui/dom)             |

## Key Patterns

### Table Display

- Detected via Lezer syntax tree, replaced with block widget decorations
- Always rendered as widgets (no inline editing of raw markdown)
- **Rebuilds**: Structural edits rebuild single table; in-cell edits map decorations; sync transactions skip rebuilds
- **Height**: Heuristic estimate + ResizeObserver + LRU cache (200 entries)
- **Cell content**: Async HTML render via Joplin's `renderMarkup`, cached (500 entries), sanitized via DOMPurify

### Nested Editor Pattern

- Subview contains full document, hides content outside cell range
- **Sync**: `syncAnnotation` prevents loops; changes/selection mirrored bidirectionally
- **History**: Main editor owns history; subview uses `addToHistory: false`; Ctrl+Z/Y forwarded to main
- **Boundary enforcement**: Rejects out-of-range edits, converts newlines to `<br>`, escapes pipes to `\|`

### Structural Commands Flow

```
User action → tableCommands.ts → tableCommandSemantics.ts → tableTransactionHelpers.ts → markdownTableManipulation.ts
```

Parse table → mutate TableData → serialize to markdown → dispatch replacement

## Critical Implementation Details

- **Full doc replacement** (sync): Detected via single `[0, doc.length]` change; clears active cell, rebuilds tables on next frame
- **Android**: `mainEditorGuard` blocks errant main-editor edits; event handlers stop input/composition bubbling
- **Context injection**: Reference link definitions injected into cell render payloads for `[text][label]` syntax
- **Footnotes**: Post-processed via regex (markdown-it-footnote breaks with isolated cell rendering)

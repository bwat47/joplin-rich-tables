# Architecture Overview

A Joplin plugin that replaces Markdown table syntax with interactive `TableWidget` decorations using CodeMirror 6.

## Content Script Layers

- `tableModel/`: pure table parsing, serialization, and table math.
- `tableState/`: CodeMirror `StateField`/`StateEffect` definitions and selectors.
- `tableRuntime/`: editor-bound orchestration with shared runtime primitives at the root and subdomains for `activeCell/`, `interaction/`, `lifecycle/`, `navigation/`, `operations/`, and `selection/`.
- `tableWidget/`: widget rendering, DOM helpers, widget visuals, and widget-local event handling.
- `tableCommands/`: Joplin command registration only.
- `nestedEditor/`: isolated in-cell editor implementation.
- `services/`: Joplin/external integration.
- `shared/`: generic helpers with no table-feature ownership.

Host/editor settings are startup-only. The content script fetches a normalized host config from Joplin before installing
the CodeMirror extension, then exposes that snapshot through `hostEditorConfigFacet`; runtime code reads the facet rather
than calling back into Joplin or keeping module-level settings caches.

## Documentation Index

- [Table-Display.md](./Table-Display.md) - Rendering, optimizations, display modes.
- [Table-Runtime-Invariants.md](./Table-Runtime-Invariants.md) - Cross-module runtime rules for active cells, sync, rebuilds, and focus.
- [Nested-Editor-Architecture.md](./Nested-Editor-Architecture.md) - Synchronization, boundary enforcement, undo/redo.
- [Interaction-and-Navigation.md](./Interaction-and-Navigation.md) - Keyboard navigation, selection logic.
- [Structural-Commands-and-Serialization.md](./Structural-Commands-and-Serialization.md) - Command flow, serialization.
- [Markdown-Rendering.md](./Markdown-Rendering.md) - Cell Markdown rendering, context injection.
- [Table-Parsing.md](./Table-Parsing.md) - Table parsing and cell-range computation.
- [ADR/](../ADR/) - Architecture Decision Records.

---

## Editor Hierarchy

1. **Main Editor (CodeMirror)**: Parses document, identifies table ranges via Lezer syntax tree.
2. **Table Widget**: Block decoration replacing raw Markdown. Renders HTML table grid.
3. **Nested Editor**: Transient isolated CodeMirror instance spawned inside `<td>` for in-cell editing.

## Core Components

| Component     | File                                                            | Purpose                                                          |
| :------------ | :-------------------------------------------------------------- | :--------------------------------------------------------------- |
| **Wiring**    | `contentScript/tableWidget/tableWidgetExtension.ts`             | Main entry point; initializes services and assembles extensions. |
| **Rendering** | `contentScript/tableWidget/TableWidget.ts`                      | HTML rendering, click-to-cell coordinate mapping.                |
| **Lifecycle** | `contentScript/tableRuntime/lifecycle/nestedEditorLifecycle.ts` | Nested editor open/close state, synchronization triggers.        |
| **Styles**    | `contentScript/tableWidget/tableStyles.ts`                      | CSS-in-JS for theme consistency.                                 |
| **Editor**    | `contentScript/nestedEditor/nestedEditorController.ts`          | Nested editor mount/sync/close behavior.                         |
| **Parsing**   | `contentScript/tableModel/MarkdownTable.ts`                     | Normalized table model, parsing, serialization, mutations.       |
| **Context**   | `contentScript/tableModel/tableContext.ts`                      | Shared parsed table + cell ranges + table span.                  |
| **State**     | `contentScript/tableState/activeCellState.ts`                   | Logical active-cell state and effect wiring.                     |
| **Runtime**   | `contentScript/tableRuntime/operations/structuralOperations.ts` | Editor transaction orchestration for structural table commands.  |
| **Toolbar**   | `contentScript/toolbar/tableToolbarPlugin.ts`                   | Floating UI for row/column/alignment actions.                    |

## Data Flow

### 1. Detection and Display

Lezer identifies table blocks. `tableDecorationField` builds shared `TableContext` objects and replaces table source ranges with `TableWidget` block decorations.

See [Table-Parsing.md](./Table-Parsing.md) and [Table-Display.md](./Table-Display.md).

### 2. Cell Interaction

Cell clicks, keyboard navigation, and selection-mode actions resolve table/cell coordinates from widget DOM plus `TableContext`.

Interactive cell entry dispatches logical active-cell state plus an explicit open request. `nestedEditorLifecycle.ts` resolves current document offsets and mounts the nested editor.

See [Interaction-and-Navigation.md](./Interaction-and-Navigation.md) and [Nested-Editor-Architecture.md](./Nested-Editor-Architecture.md).

### 3. Nested Editing

The nested editor contains only the active cell text. `nestedEditorController.ts` translates text and selections between local cell coordinates and root document coordinates through `cellTextCodec.ts`, using `syncAnnotation` for cross-editor transactions.

The main editor remains authoritative for document state and history.

See [Nested-Editor-Architecture.md](./Nested-Editor-Architecture.md).

### 4. Structural Mutations

Structural commands resolve the current active cell, run table-model command semantics, serialize the resulting `MarkdownTable`, replace the source table range, and dispatch explicit reopen intent when a cell should remain active.

See [Structural-Commands-and-Serialization.md](./Structural-Commands-and-Serialization.md).

### 5. Markdown Rendering

Inactive cells render Markdown through the `MarkdownRenderService`, which calls Joplin's `renderMarkup`, sanitizes and post-processes HTML, caches rendered payloads, and upgrades Markdown-looking cells asynchronously.

See [Markdown-Rendering.md](./Markdown-Rendering.md).

## Runtime Ownership

Common ownership boundaries:

- `tableModel/` owns editor-independent table parsing, ranges, serialization, and command semantics.
- `tableRuntime/` owns editor-bound orchestration and active-cell lifecycle.
- `nestedEditor/` owns nested editor mount, synchronization, selection mirroring, and cleanup.
- `editorBridge/` owns cross-editor text/selection conversion and main-editor guard policy.
- `tableWidget/` owns widget DOM, visual styling, display-mode behavior, and decoration policy.

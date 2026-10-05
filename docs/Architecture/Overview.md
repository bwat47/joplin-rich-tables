# Architecture Overview

A Joplin plugin that replaces Markdown table syntax with interactive `TableWidget` decorations using CodeMirror 6.

## Content Script Layers

- `tableModel/`: Lezer syntax projection, normalized table semantics, serialization, and table math.
- `tableState/`: CodeMirror `StateField`/`StateEffect` definitions, selectors, state-derived active-cell resolution, active-cell change classification, and open-cell request state.
- `tableRuntime/`: editor-bound orchestration with shared runtime primitives at the root and subdomains for `activeCell/`, `interaction/` (widget press/click routing, pointer gestures, outside-interaction handling, and nested-editor table interaction extensions), `lifecycle/`, `navigation/`, `operations/`, and `selection/`.
- `tableWidget/`: widget rendering, DOM measurement and coordinate reading, DOM-to-table-context resolution, and widget visuals.
- `tableCommands/`: Joplin command registration only.
- `nestedEditor/`: isolated in-cell editor implementation.
- `services/`: Joplin/external integration.
- `shared/`: generic helpers with no table-feature ownership.

Host/editor settings and Joplin-backed services are startup-owned. The content script fetches a normalized host config
from Joplin before installing the CodeMirror extension, creates shared bridge-backed services, then exposes those
dependencies through facets; runtime code reads facets rather than calling back into Joplin or keeping module-level
mutable state.

The composition root, `contentScript/tableWidgetExtension.ts`, initializes services and registers every extension. It
sits outside the layer folders so it may import from all of them.

### Allowed Dependencies

Enforced by `eslint.config.mjs` (`import-x/no-restricted-paths` on resolved paths).

| Module           | Allowed dependencies                                                            |
| :--------------- | :------------------------------------------------------------------------------ |
| `shared`         | None                                                                            |
| `services`       | `shared`                                                                        |
| `tableModel`     | `shared`                                                                        |
| `tableState`     | `shared`, `tableModel`                                                          |
| `nestedEditor`   | `shared`, `services`, `tableModel`, `tableState`                                |
| `tableWidget`    | `shared`, `services`, `tableModel`, `tableState`, `nestedEditor`                |
| `tableRuntime`   | `shared`, `services`, `tableModel`, `tableState`, `tableWidget`, `nestedEditor` |
| `toolbar`        | `shared`, `services`, `tableModel`, `tableState`, `tableWidget`, `tableRuntime` |
| `tableCommands`  | `shared`, `tableModel`, `tableState`, `tableRuntime`                            |
| Composition root | All layers                                                                      |

## Documentation Index

- [Table-Display.md](./Table-Display.md) - Rendering, optimizations, display modes.
- [Table-Runtime-Invariants.md](./Table-Runtime-Invariants.md) - Cross-module runtime rules for active cells, sync, rebuilds, and focus.
- [Nested-Editor-Architecture.md](./Nested-Editor-Architecture.md) - Synchronization, boundary enforcement, undo/redo.
- [Interaction-and-Navigation.md](./Interaction-and-Navigation.md) - Keyboard navigation, selection logic.
- [Structural-Commands-and-Serialization.md](./Structural-Commands-and-Serialization.md) - Command flow, serialization.
- [Markdown-Rendering.md](./Markdown-Rendering.md) - Cell Markdown rendering.
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
| **Wiring**    | `contentScript/tableWidgetExtension.ts`                         | Main entry point; initializes services and assembles extensions. |
| **Rendering** | `contentScript/tableWidget/TableWidget.ts`                      | HTML rendering, click-to-cell coordinate mapping.                |
| **Lifecycle** | `contentScript/tableRuntime/lifecycle/nestedEditorLifecycle.ts` | Nested editor open/close state, synchronization triggers.        |
| **Styles**    | `contentScript/tableWidget/tableStyles.ts`                      | CSS-in-JS for theme consistency.                                 |
| **Editor**    | `contentScript/nestedEditor/nestedEditorController.ts`          | Nested editor mount/sync/close behavior.                         |
| **Syntax**    | `contentScript/tableModel/lezerTableSyntax.ts`                  | Root-table syntax projection from Lezer.                         |
| **Model**     | `contentScript/tableModel/MarkdownTable.ts`                     | Normalized table model, serialization, mutations.                |
| **Context**   | `contentScript/tableState/tableContextField.ts`                 | Authoritative root-table index and selectors.                    |
| **State**     | `contentScript/tableState/activeCellState.ts`                   | Logical active-cell state and effect wiring.                     |
| **Runtime**   | `contentScript/tableRuntime/operations/runStructuralCommand.ts` | Editor transaction orchestration for structural table commands.  |
| **Toolbar**   | `contentScript/toolbar/tableToolbarPlugin.ts`                   | Floating UI for row, column, alignment, and sorting actions.     |

## Data Flow

### 1. Detection and Display

Lezer identifies root table blocks and provides their row, delimiter, and cell spans. `tableContextField` scans those
root tables once per document change and owns the current `TableContext` index. `tableDecorationField` consumes the
index and replaces its exact source ranges with `TableWidget` block decorations.

See [Table-Parsing.md](./Table-Parsing.md) and [Table-Display.md](./Table-Display.md).

### 2. Cell Interaction

Cell clicks, keyboard navigation, and selection-mode actions resolve table/cell coordinates from widget DOM plus `TableContext`.

Interactive cell entry dispatches logical active-cell state plus an explicit open request. `nestedEditorLifecycle.ts` resolves current document offsets and mounts the nested editor.

See [Interaction-and-Navigation.md](./Interaction-and-Navigation.md) and [Nested-Editor-Architecture.md](./Nested-Editor-Architecture.md).

### 3. Nested Editing

The nested editor contains only the active cell text. `nestedEditorController.ts` translates text and selections between local cell coordinates and root document coordinates through `cellTextNormalization.ts` and `cellTextCodec.ts`, using `syncAnnotation` for cross-editor transactions.

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

- `tableModel/` projects Lezer syntax into editable ranges and owns normalized semantics, serialization, and table math.
- `tableState/resolvedActiveCell.ts` resolves logical active-cell identity into current table context and document ranges, using only state and model dependencies.
- `tableRuntime/` owns editor-bound orchestration, active-cell lifecycle, nested-editor table interaction extensions, and the main-editor guard policy.
- `nestedEditor/` owns nested editor mount, synchronization, selection mirroring, and cleanup.
- `shared/` holds feature-agnostic primitives, including `syncAnnotation` and cell text/selection conversion (`cellTextCodec`).
- `tableWidget/` owns widget DOM, visual styling, display-mode behavior, and decoration policy.

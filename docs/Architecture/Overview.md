# Architecture Overview

A Joplin plugin that replaces Markdown table syntax with interactive `TableWidget` decorations using CodeMirror 6.

## Content Script Layers

- `tableModel/`: Lezer syntax projection into editable ranges, normalized table semantics, serialization, table math, cell text encoding, and cell text selection mapping.
- `tableState/`: CodeMirror `StateField`/`StateEffect` definitions, selectors, active-cell change classification, and open-cell request state. `tableContextField.ts` is the authoritative root-table index. `activeCellState.ts` holds logical active-cell state. `resolvedActiveCell.ts` resolves that identity into the current table context and document ranges, clamping requested targets and resolving stored identities strictly. `activeCellTarget.ts` constructs active-cell identity and selection anchors for serialized tables.
- `tableRuntime/`: editor-bound orchestration, with shared runtime primitives at the root and subdomains for `boundaries/` (blank-line separation and adjacent-table resolution), `guard/` (main-editor transaction guard and active-cell input sanitization), `interaction/` (widget press/click routing, pointer gestures, outside-interaction handling, and nested-editor table interaction extensions), `lifecycle/`, `navigation/`, `operations/`, and `selection/`.
- `tableWidget/`: widget DOM and rendering, DOM measurement and coordinate reading, DOM-to-table-context resolution, visual styling, display-mode behavior, and decoration policy.
- `nestedEditor/`: in-cell editor mount, synchronization, selection mirroring, and cleanup.
- `toolbar/`: floating UI for row, column, alignment, and sorting actions (`tableToolbarPlugin.ts`).
- `tableCommands/`: Joplin command registration only.
- `services/`: Joplin/external integration.
- `shared/`: helpers and cross-layer contracts that depend on no other content-script layer, including `syncAnnotation`, `tableDomClasses`, and `footnoteAnchor`.

Host/editor settings and Joplin-backed services are startup-owned. The content script fetches a normalized host config
from Joplin before installing the CodeMirror extension, creates shared bridge-backed services, then exposes those
dependencies through facets; runtime code reads facets rather than calling back into Joplin or keeping module-level
mutable state.

The composition root, `contentScript/tableWidgetExtension.ts`, initializes services and registers every extension. It
sits outside the layer folders so it may import from all of them.

### Allowed Dependencies

`LAYER_DEPENDENCIES` in `eslint.config.mjs` is the source of truth. `shared`, `tableModel`, and `tableState` never
depend on editor orchestration or UI. `tableRuntime` sits below `toolbar` and `tableCommands`, which reach the editor
only through state and runtime APIs. Tests and the composition root are outside every layer zone.

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

The nested editor contains only the active cell text. `nestedEditorController.ts` translates text and selections between local cell coordinates and root document coordinates through `tableModel/cellTextNormalization.ts` and `tableModel/cellTextSelection.ts`, using `syncAnnotation` for cross-editor transactions.

The main editor remains authoritative for document state and history.

See [Nested-Editor-Architecture.md](./Nested-Editor-Architecture.md).

### 4. Structural Mutations

Structural commands resolve the current active cell, run table-model command semantics, serialize the resulting `MarkdownTable`, replace the source table range, and dispatch explicit reopen intent when a cell should remain active.

See [Structural-Commands-and-Serialization.md](./Structural-Commands-and-Serialization.md).

### 5. Markdown Rendering

Inactive cells render Markdown through the `MarkdownRenderService`, which calls Joplin's `renderMarkup`, sanitizes and post-processes HTML, caches rendered payloads, and upgrades Markdown-looking cells asynchronously.

See [Markdown-Rendering.md](./Markdown-Rendering.md).

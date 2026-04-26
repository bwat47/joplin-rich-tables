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

## Documentation Index

- [Table-Display.md](./Table-Display.md) - Rendering, optimizations, display modes.
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
| **Runtime**   | `contentScript/tableRuntime/operations/structuralOperations.ts` | Table mutation orchestration and target-cell rebasing.           |
| **Toolbar**   | `contentScript/toolbar/tableToolbarPlugin.ts`                   | Floating UI for row/column/alignment actions.                    |

## Data Flow

### 1. Detection

StateField scans syntax tree → detects table blocks → replaces with `TableWidget`.

### 2. Interaction

Cell click / navigation / selection focus → widget/runtime logic resolves row/column → dispatches
`setActiveCellEffect` plus an open request and id-only open signal → `tableRuntime/lifecycle/nestedEditorLifecycle` mounts the nested editor.

`ActiveCell` is logical-first state: it persists `tableFrom` plus `section/row/col`. Cursor placement such as
the main-editor selection anchor is transient request data, not part of persisted active-cell identity. Raw offsets
such as `tableTo` plus semantic/editable cell spans are derived on demand through the shared active-cell resolver.

Before lifecycle opens the nested editor for user-driven entry, `tableRuntime/lifecycle/nestedEditorLifecycle.ts` checks whether the table markdown
is already in the plugin's canonical serialized form. If not, it rewrites the whole table once, preserves the logical
target cell, dispatches a reopen intent, rebuilds the widget, and only then opens the nested editor. Lifecycle reopens
used for undo/redo or UI restoration skip that normalization step. Passive parsing/rendering never mutates document text.

### 3. Synchronization

Typing in the isolated cell editor goes through the `NestedEditorSession` bridge:

- `editorBridge/cellTextCodec.ts` sanitizes local display text and selection into authoritative root cell text and selection.
- The main editor applies the change with `editorBridge/syncAnnotation.ts`.
- Non-sync root changes re-resolve the logical cell from the persisted active-cell identity and rebase the isolated editor.
- `cellRanges` expose both trimmed semantic bounds and editable bounds; nested-editor sync and Joplin formatting-command
  selection mirroring use the editable span so user-entered edge whitespace stays addressable without exposing canonical
  delimiter padding in the local editor.
- The nested editor is cell-local, not a clipped whole-document subview.

### 4. Table Runtime Model

`MarkdownTable` is the canonical runtime representation for parsed tables:

- Parses Markdown into normalized header/alignment/body state.
- Owns serialization and structural row/column/alignment operations.
- Feeds command execution and widget rendering through `TableContext`.
- Leaves source-coordinate computation to `markdownTableCellRanges.ts`.

### 5. Shared Derived Table Context

`TableContext` bundles:

- The resolved table span in the document (`from`, `to`, `text`).
- The parsed `MarkdownTable`.
- The computed `cellRanges` used for activation and navigation.

This is the shared derived object used across widget rendering, table interactions,
navigation, and command helpers so the plugin does not repeatedly run separate
resolve -> parse -> compute-ranges chains for the same table content.

`tableRuntime/tableResolution.ts` owns generic syntax-tree table lookup and cell-range
resolution. `tableRuntime/tablePositioning.ts` is limited to DOM/event target fallback
resolution for widget interactions.

The active-cell resolver builds on `TableContext` and is the only supported way to
derive current table/cell offsets for the persisted logical active-cell state.
Once current-state code has a concrete active cell, it should pass `ResolvedActiveCell`
through the runtime instead of re-threading table context and raw offsets separately.

### 6. Shared Transition Policy

Table editing transition logic is split by responsibility:

- `tableRuntime/lifecycle/lifecyclePolicy.ts` is pure lifecycle policy: it inspects `ViewUpdate` state and returns declarative lifecycle actions.
- `tableRuntime/lifecycle/nestedEditorLifecycle.ts` executes lifecycle side effects such as open/close and RAF scheduling.
- `editorBridge/mainEditorGuardPolicy.ts` owns main-editor transaction filtering and paste rewrite decisions while nested editing is active.
- `tableWidget/tableDecorationPolicy.ts` owns block-decoration rebuild decisions.
- `nestedEditor/nestedEditorController.ts` owns nested editor mount, local/root synchronization, selection mirroring, and session invalidation.
- `editorBridge/cellTextCodec.ts` and `editorBridge/syncAnnotation.ts` own the cross-editor text/selection protocol.

Non-lifecycle modules should request nested-editor opening via effects, and
`nestedEditorLifecycle.ts` decides whether to normalize before delegating mount/sync/close behavior to
`nestedEditor/nestedEditorController.ts`.

**Sync Flow Diagram**:

```mermaid
flowchart TB
    subgraph User["User Input"]
        K["Keyboard/Mouse"]
    end

    subgraph Nested["Nested Editor (isolated cell editor)"]
        NE["nestedEditorController.ts"]
        DH["domHandlers.ts"]
    end

    subgraph Main["Main Editor"]
        ME["Main EditorView"]
        LC["tableRuntime/lifecycle/nestedEditorLifecycle.ts"]
    end

    K --> DH
    DH -->|"keymap: Tab/Enter/Arrows"| NE
    DH -->|"undo/redo passthrough"| ME
    DH -->|"event bubbling prevention"| NE

    NE -->|"cellTextCodec + syncAnnotation"| ME
    NE -->|"selection mirror"| ME

    ME -->|"external changes (undo/redo, Joplin commands)"| LC
    LC -->|"forward root update"| NE
    LC -->|"detect structural changes → reopen cell"| NE
```

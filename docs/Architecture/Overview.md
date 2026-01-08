# Architecture Overview

A Joplin plugin that replaces Markdown table syntax with interactive `TableWidget` decorations using CodeMirror 6.

## Documentation Index

- [Table-Display.md](./Table-Display.md) - Rendering, optimizations, display modes.
- [Nested-Editor-Architecture.md](./Nested-Editor-Architecture.md) - Synchronization, boundary enforcement, undo/redo.
- [Interaction-and-Navigation.md](./Interaction-and-Navigation.md) - Keyboard navigation, selection logic.
- [Structural-Commands-and-Serialization.md](./Structural-Commands-and-Serialization.md) - Command flow, serialization.
- [Services-and-Parsing.md](./Services-and-Parsing.md) - Markdown rendering, context injection.
- [ADR/](./ADR/) - Architecture Decision Records.

---

## Editor Hierarchy

1. **Main Editor (CodeMirror)**: Parses document, identifies table ranges via Lezer syntax tree.
2. **Table Widget**: Block decoration replacing raw Markdown. Renders HTML table grid.
3. **Nested Editor**: Transient CodeMirror instance spawned inside `<td>` for in-cell editing.

## Core Components

| Component     | File                                                  | Purpose                                                   |
| :------------ | :---------------------------------------------------- | :-------------------------------------------------------- |
| **Wiring**    | `contentScript/tableWidget/tableWidgetExtension.ts`   | Main entry point; connects plugins, styles, commands.     |
| **Rendering** | `contentScript/tableWidget/TableWidget.ts`            | HTML rendering, click-to-cell coordinate mapping.         |
| **Lifecycle** | `contentScript/tableWidget/nestedEditorLifecycle.ts`  | Nested editor open/close state, synchronization triggers. |
| **Styles**    | `contentScript/tableWidget/tableStyles.ts`            | CSS-in-JS for theme consistency.                          |
| **Editor**    | `contentScript/nestedEditor/nestedCellEditor.ts`      | ViewPlugin actualizing nested editor lifecycle.           |
| **Parsing**   | `contentScript/tableModel/markdownTableRowScanner.ts` | Pipe delimiter detection, escaped character handling.     |
| **Toolbar**   | `contentScript/toolbar/tableToolbarPlugin.ts`         | Floating UI for row/column/alignment actions.             |

## Data Flow

### 1. Detection

StateField scans syntax tree → detects table blocks → replaces with `TableWidget`.

### 2. Interaction

Cell click → `TableWidget` calculates row/column → dispatches `setActiveCellEffect` → `nestedEditorLifecycle` mounts nested editor.

### 3. Synchronization

Typing in nested editor → `forwardChangesToMain` creates transaction with `syncAnnotation` → main editor applies → annotation prevents re-render loop.

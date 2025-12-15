# Rich Tables Plugin

Joplin plugin that renders Markdown tables as interactive HTML tables in CodeMirror 6, with in-cell editing via nested editors.

## Architecture

### Core Components

| File                      | Purpose                                                           |
| ------------------------- | ----------------------------------------------------------------- |
| `tableWidgetExtension.ts` | Main extension: decorations, lifecycle plugin, styles             |
| `TableWidget.ts`          | Table parsing, HTML rendering, click-to-cell mapping              |
| `activeCellState.ts`      | Tracks active cell range in main editor state                     |
| `nestedCellEditor.ts`     | Orchestrates nested editor (delegates to `nestedEditor/` modules) |
| `nestedEditor/`           | Sub-modules: `transactionPolicy`, `mounting`, `domHandlers`       |
| `tableNavigation.ts`      | Navigation logic (Tab/Enter/Arrows) and cell switching            |
| `markdownRenderer.ts`     | Provides `MarkdownRenderService` (async rendering with caching)   |

### Table Display

- Tables detected via Lezer syntax tree (scan timeout increased to 500ms, resolve to 1500ms for large tables)
- Replaced with `Decoration.replace({ widget, block: true })` via StateField
- Widget reports an estimated height to reduce scroll jumps while rendering
- Cell content rendered as HTML via Joplin's `renderMarkup` (async, cached)
- Supports column alignments (`:---`, `:---:`, `---:`)

### In-Cell Editing (Nested Editor Pattern)

**Strategy**: Embed a CodeMirror subview inside the clicked cell. Subview contains the full document but hides everything outside the active cell range.

**Activation**: Click cell → compute cell range → dispatch `setActiveCellEffect` → open nested editor

**Active cell styling**: The hosting `<td>` is marked with an active class for outline styling.

**Sync**:

- `syncAnnotation` prevents infinite loops
- Subview → Main: `forwardChangesToMain` listener dispatches changes with sync annotation
- Main → Subview: `nestedEditorLifecyclePlugin` calls `applyMainTransactionsToNestedEditor`
- Changes and range updates combined in single transaction to prevent double-mapping

**History**: Main editor owns undo history. Subview uses `addToHistory: false`. Ctrl+Z/Y intercepted and forwarded to main via `undo()`/`redo()` commands.

**Boundary Enforcement** (transaction filter):

- Rejects changes outside `[cellFrom, cellTo]`
- Rejects newlines (`\n`, `\r`)
- Escapes unescaped pipes (`|` → `\|`)
- Clamps selection to cell bounds (using mapped new bounds for doc changes)

**Range Mapping**: Uses `assoc=-1` for `from` positions, `assoc=1` for `to` positions, so insertions at boundaries expand the visible range (even for empty cells).

**Event Handling & Navigation**:

- **Keyboard Navigation**:
    - `Tab` / `Shift+Tab`: Next/Previous cell
    - `Enter`: Cell below
    - `ArrowLeft` / `ArrowRight`: Navigate to prev/next cell when at content boundary
    - `ArrowUp` / `ArrowDown`: Navigate to cell above/below when at visual line boundary (handles wrapping)
- **Shortcuts**: standard Joplin shortcuts (Ctrl+B) blocked; Ctrl+A/C/V/X supported natively.
- **Context Menu**: suppressed.

### Deactivation

- Click outside table or widget
- `clearActiveCellEffect` dispatched
- `nestedEditorLifecyclePlugin` closes subview
- Decorations rebuilt to show updated rendered content
- Widget destruction also closes any hosted nested editor to avoid orphaned subviews

## References

- [Joplin CM6 Plugin API](https://joplinapp.org/help/api/tutorials/cm6_plugin/)
- [CodeMirror 6 Decorations](https://codemirror.net/docs/ref/#view.Decoration)

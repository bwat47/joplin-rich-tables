# Rich Tables Plugin

Joplin plugin that renders Markdown tables as interactive HTML tables in CodeMirror 6, with in-cell editing via nested editors.

## Architecture

### Core Components

| File                                                  | Purpose                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `contentScript/tableWidget/tableWidgetExtension.ts`   | Main extension: decorations, lifecycle plugin, styles                          |
| `contentScript/tableWidget/TableWidget.ts`            | Table HTML rendering + click-to-cell mapping                                   |
| `contentScript/tableWidget/tableHeightCache.ts`       | LRU cache for measured table heights (improves scroll stability)               |
| `contentScript/tableWidget/domConstants.ts`           | Centralized DOM selectors, class names, and data attributes                    |
| `contentScript/tableWidget/activeCellState.ts`        | Tracks active cell range in main editor state                                  |
| `contentScript/tableWidget/tableNavigation.ts`        | Navigation logic (Tab/Enter/Arrows) and cell switching                         |
| `contentScript/tableWidget/tablePositioning.ts`       | Maps DOM/table positions to document ranges                                    |
| `contentScript/nestedEditor/nestedCellEditor.ts`      | Orchestrates nested editor (delegates to `nestedEditor/` modules)              |
| `contentScript/nestedEditor/decorationPlugins.ts`     | View plugins for custom syntax (inline code borders, `==mark==`)               |
| `contentScript/nestedEditor/`                         | Sub-modules: `transactionPolicy`, `mounting`, `domHandlers`, `mainEditorGuard` |
| `contentScript/tableModel/markdownTableRowScanner.ts` | Shared scanner: detects pipe delimiters, handles escaped pipes and inline code |
| `contentScript/tableModel/`                           | Markdown table parsing/ranges/manipulation helpers                             |
| `contentScript/toolbar/`                              | Floating table toolbar + header semantics                                      |
| `contentScript/toolbar/tableToolbarPlugin.ts`         | Floating-toolbar view plugin (uses Floating UI for positioning)                |
| `contentScript/services/markdownRenderer.ts`          | `MarkdownRenderService` (async rendering with caching)                         |

### Table Display

- Tables detected via Lezer syntax tree (scan timeout increased to 500ms, resolve to 1500ms for large tables)
- Replaced with `Decoration.replace({ widget, block: true })` via StateField
- Widget uses cached measured heights for accurate `estimatedHeight` (keyed by position + content hash, measured on mount/async-render/destroy)
- Cell content rendered as HTML via Joplin's `renderMarkup` (async, cached with FIFO eviction at 500 entries)
- Supports column alignments (`:---`, `:---:`, `---:`)
- Wide tables scroll horizontally within the widget container

**Table Parsing**: Shared scanner detects cell boundaries by identifying unescaped pipe delimiters while ignoring pipes inside inline code spans (`` `code` ``). Unclosed backticks are treated as literals.

### In-Cell Editing (Nested Editor Pattern)

**Strategy**: Embed a CodeMirror subview inside the clicked cell. Subview contains the full document but hides everything outside the active cell range.

**Activation**: Click cell → compute cell range → dispatch `setActiveCellEffect` → open nested editor

**Active cell styling**: The hosting `<td>` is marked with an active class for outline styling. The nested editor uses CodeMirror's selection layer for highlighting (styled via Joplin CSS vars) and makes the native `::selection` highlight transparent (to avoid the default blue overlay).

**Sync**:

- `syncAnnotation` prevents infinite loops
- Subview → Main: `forwardChangesToMain` listener dispatches changes with sync annotation
- Subview → Main: selection is mirrored so Joplin-native toolbar/actions operate on the active cell selection
- Main → Subview: `nestedEditorLifecyclePlugin` calls `applyMainTransactionsToNestedEditor`
- Main → Subview: selection is mirrored after Joplin-native commands that update the main selection (e.g. Insert Link)
- Changes and range updates combined in single transaction to prevent double-mapping
- Mobile focus: a defensive focus guard reclaims nested-editor focus (with `preventScroll`) when Android steals focus after toolbar actions

**History**: Main editor owns undo history. Subview uses `addToHistory: false`. Ctrl+Z/Y intercepted and forwarded to main via `undo()`/`redo()` commands.

**Boundary Enforcement** (transaction filter):

- Rejects changes outside `[cellFrom, cellTo]`
- Rejects newlines (`\n`, `\r`)
- Escapes unescaped pipes (`|` → `\|`)
- Clamps selection to cell bounds (using mapped new bounds for doc changes)

**Range Mapping**: Uses `assoc=-1` for `from` positions, `assoc=1` for `to` positions, so insertions at boundaries expand the visible range (even for empty cells).

**Syntax Highlighting**:

- Uses `markdown({ extensions: [GFM, ...] })` to support GitHub Flavored Markdown (tables, strikethrough, tasklists).
- **Custom Decorations** (`decorationPlugins.ts`):
    - **Inline Code**: ViewPlugin wraps the entire `InlineCode` node (including backticks) to provide a unified border/background. Uses `ensureSyntaxTree` (100ms timeout) to guarantee styling in large documents.
    - **Mark**: `MatchDecorator` highlights `==text==` syntax (Joplin specific).
- **Sync Parsing**: `ensureSyntaxTree` (500ms timeout) is called before subview mount to prevent highlighting flicker (FOUC).

**Event Handling & Navigation**:

- **Keyboard Navigation**:
    - `Tab` / `Shift+Tab`: Next/Previous cell
    - `Enter`: Cell below
    - `ArrowLeft` / `ArrowRight`: Navigate to prev/next cell when at content boundary
    - `ArrowUp` / `ArrowDown`: Navigate to cell above/below when at visual line boundary (handles wrapping)
    - **Scrolling**: Cells outside viewport are automatically scrolled into view when navigating via keyboard. Uses `requestAnimationFrame` and only scrolls CodeMirror's container (preserves Joplin's sidebar layout).
- **Shortcuts**: formatting shortcuts (Ctrl+B/I, Ctrl+`/Ctrl+E) and Insert Link (Ctrl+K) are supported within the cell. Ctrl+A selects all text in the current cell. Standard editor shortcuts (Ctrl+C/V/X/Z/Y) are supported. Global shortcuts (Ctrl+S, Ctrl+P) bubble to the app. Ctrl+F is blocked.
- **Context Menu**: Native browser context menu is allowed (Paste works, Copy may be disabled).
- **Mobile (Android)**: `beforeinput`/`input`/composition events stopped from bubbling to main editor; `mainEditorGuard` rejects main-editor edits outside active cell and newlines while nested editor is open.

### Deactivation

- Click outside table or widget
- `clearActiveCellEffect` dispatched
- `nestedEditorLifecyclePlugin` closes subview
- Decorations rebuilt to show updated rendered content
- Widget destruction also closes any hosted nested editor to avoid orphaned subviews
- **Note switch**: `richTablesCloseNestedEditor` command (called via `onNoteSelectionChange`) closes nested editor and moves cursor out of any table to prevent raw markdown display

### Toolbar

- **Insert Table**: Button in Joplin's editor toolbar inserts a 2x2 empty table.
- **Floating Toolbar**: Appears when a cell is active; positioned by `@floating-ui/dom` (auto-updated on scroll/resize/layout shifts) and hidden when its table is clipped/out of view.

## References

- [Joplin CM6 Plugin API](https://joplinapp.org/help/api/tutorials/cm6_plugin/)
- [CodeMirror 6 Decorations](https://codemirror.net/docs/ref/#view.Decoration)

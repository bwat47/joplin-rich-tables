This document is for LLM context, be concise and avoid excess verbose details.

# Rich Tables Plugin

Joplin plugin that renders Markdown tables as interactive HTML tables in CodeMirror 6, with in-cell editing via nested editors.

## Architecture

### Core Components

| File                                                  | Purpose                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `contentScript/tableWidget/tableWidgetExtension.ts`   | Main wiring: connects plugins, styles, and command registration                    |
| `contentScript/tableWidget/tableStyles.ts`            | CSS-in-JS styles for the table widget                                              |
| `contentScript/tableWidget/nestedEditorLifecycle.ts`  | Manages nested editor lifecycle (open/close/sync)                                  |
| `contentScript/tableWidget/sourceMode.ts`             | Source mode toggle (shows all tables as raw markdown)                              |
| `contentScript/tableWidget/searchForceSourceMode.ts`  | Search override state (forces all tables as raw markdown while search is open)     |
| `contentScript/tableWidget/searchPanelWatcher.ts`     | Watches search panel open/close, toggles search override                           |
| `contentScript/tableCommands/`                        | Table manipulation commands and shared execution logic                             |
| `contentScript/tableModel/tableTransactionHelpers.ts` | Shared transaction logic (`runTableOperation`) for table edits                     |
| `contentScript/tableWidget/TableWidget.ts`            | Table HTML rendering + click-to-cell mapping                                       |
| `contentScript/tableWidget/tableHeightCache.ts`       | LRU cache for measured table heights (improves scroll stability)                   |
| `contentScript/tableWidget/domHelpers.ts`             | Centralized DOM selectors, class names, and data attributes                        |
| `contentScript/tableWidget/activeCellState.ts`        | Tracks active cell range in main editor state                                      |
| `contentScript/tableWidget/tableNavigation.ts`        | Navigation logic (Tab/Enter/Arrows) and cell switching                             |
| `contentScript/tableWidget/tablePositioning.ts`       | Maps DOM/table positions to document ranges                                        |
| `contentScript/nestedEditor/nestedCellEditor.ts`      | ViewPlugin managing nested editor lifecycle (delegates to `nestedEditor/` modules) |
| `contentScript/nestedEditor/decorationPlugins.ts`     | View plugins for custom syntax (inline code borders, `==mark==`)                   |
| `contentScript/nestedEditor/`                         | Sub-modules: `transactionPolicy`, `mounting`, `domHandlers`, `mainEditorGuard`     |
| `contentScript/tableModel/markdownTableRowScanner.ts` | Shared scanner: detects pipe delimiters, handles escaped pipes                     |
| `contentScript/tableModel/`                           | Markdown table parsing/ranges/manipulation helpers                                 |
| `contentScript/toolbar/tableToolbarPlugin.ts`         | Floating-toolbar view plugin (uses Floating UI for positioning)                    |
| `contentScript/services/markdownRenderer.ts`          | `MarkdownRenderService` (async rendering with caching)                             |
| `contentScript/services/documentDefinitions.ts`       | StateField tracking reference link definitions for context injection               |
| `contentScript/shared/cellContentUtils.ts`            | Utilities: pipe unescaping, slugify, renderable content builder                    |

### Table Display

- Tables detected via Lezer syntax tree (scan timeout increased to 500ms, resolve to 1500ms for large tables)
- Replaced with `Decoration.replace({ widget, block: true })` via StateField
- **Always rendered as widgets** - editing happens via nested cell editors (no "raw markdown mode" when cursor inside table)
- **Optimizations**:
  - Structural edits (row/col add/delete) rebuild only the affected table via `rebuildSingleTable()`
  - Large document replacements (>50% deleted) trigger full rebuild (note switching detection)
  - New table detection via syntax tree/decoration count comparison
  - In-cell edits: decorations mapped to preserve nested editor DOM
  - Sync transactions (nested ↔ main mirroring) skip rebuild
- **Source Mode**: Toggle to show all tables as raw markdown (Ctrl+Shift+/)
- **Search Override**: While the search panel is open, all tables are shown as raw markdown for native search highlighting
- **Widget Lookup**: Uses `posAtDOM()` instead of `data-table-from` attribute (prevents stale references after edits)
- Widget uses cached measured heights for accurate `estimatedHeight` (keyed by position + content hash, measured on mount/async-render/destroy)
- Cell content rendered as HTML via Joplin's `renderMarkup` (async, cached with FIFO eviction at 500 entries)
- **Security**: Rendered HTML sanitized via DOMPurify with hook to remove resource-icon spans
- **Context Injection**: Reference link definitions extracted via syntax tree and injected into cell render payloads, enabling reference-style links `[text][label]` to work in cells. Definitions are skipped for cells containing definition-like syntax to prevent rendering issues.
- **Footnotes**: Post-processed via regex replacement of `[^label]` literals into styled superscript links (markdown-it-footnote auto-numbering breaks with isolated cell rendering).
- Supports column alignments (`:---`, `:---:`, `---:`)
- Wide tables scroll horizontally within the widget container

**Table Parsing**: Shared scanner detects cell boundaries by identifying unescaped pipe delimiters.

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
    - `Tab` / `Shift+Tab`: Next/Previous cell (or new row on last row/column).
    - `Enter`: Cell below (or new row on last row).
    - `ArrowLeft` / `ArrowRight`: Navigate to prev/next cell when at content boundary
    - `ArrowUp` / `ArrowDown`: Navigate to cell above/below when at visual line boundary (handles wrapping)
    - **Scrolling**: Cells outside viewport are automatically scrolled into view when navigating via keyboard.
- **Shortcuts**: formatting shortcuts (Ctrl+B/I, Ctrl+`/Ctrl+E) and Insert Link (Ctrl+K) are supported within the cell. Ctrl+A selects all text in the current cell. Standard editor shortcuts (Ctrl+C/V/X/Z/Y) are supported. Global shortcuts (Ctrl+S, Ctrl+P) bubble to the app.
- **Links**: Clicking links in cells opens them via `joplin.commands.execute('openItem')`. Anchor links (footnotes `#fn-label`, headings `#slug`) are intercepted and scroll to the target in the main editor via `scrollToAnchor`.
- **Context Menu**: Native browser context menu is allowed (Paste works, Copy may be disabled).
- **Mobile (Android)**: `beforeinput`/`input`/composition events stopped from bubbling to main editor; `mainEditorGuard` rejects main-editor edits within active table but outside active cell and rejects newlines while nested editor is open.

### Deactivation

- Click outside table or widget
- `clearActiveCellEffect` dispatched
- `nestedEditorLifecyclePlugin` closes subview
- Widget stays rendered (no rebuild on deactivation)
- Widget destruction also closes any hosted nested editor to avoid orphaned subviews
- **Note switch**: `richTablesCloseNestedEditor` command (called via `onNoteSelectionChange`) closes nested editor
- **Source mode entry**: Closes nested editor and clears active cell state (prevents stale state corruption)

### Commands & Interface

**Menus**: A "Rich Tables" submenu in Joplin's Tools menu provides access to structural editing commands.

**Structural Shortcuts**:

| Action                       | Shortcut                             |
| :--------------------------- | :----------------------------------- |
| **Insert Table**             | `Alt + Shift + T`                    |
| **Insert Row Above/Below**   | `Alt + Shift + Up` / `Down`          |
| **Insert Column Left/Right** | `Alt + Shift + Left` / `Right`       |
| **Delete Row**               | `Alt + Shift + D`                    |
| **Delete Column**            | `Ctrl + Alt + Shift + D`             |
| **Move Row Up/Down**         | `Alt + Up` / `Down`                  |
| **Move Column Left/Right**   | `Alt + Left` / `Right`               |
| **Align Left/Center/Right**  | `Ctrl + Alt + Left` / `Up` / `Right` |

**Toolbars**:

- **Insert Table**: Button in Joplin's editor toolbar inserts a 2x2 empty table.
- **Toggle Source Mode**: Button in Joplin's editor toolbar (Ctrl+Shift+/) shows all tables as raw markdown.
- **Floating Toolbar**: Appears when a cell is active; positioned by `@floating-ui/dom`.

## References

- [Joplin CM6 Plugin API](https://joplinapp.org/help/api/tutorials/cm6_plugin/)
- [CodeMirror 6 Decorations](https://codemirror.net/docs/ref/#view.Decoration)

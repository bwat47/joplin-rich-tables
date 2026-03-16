> [!note]
> This plugin was created entirely with AI tools, and I may be limited in my ability to fix any issues.

# Rich Tables

A Joplin plugin to provide table rendering & table editing in the Markdown editor.

![example](https://raw.githubusercontent.com/bwat47/joplin-rich-tables/refs/heads/main/images/example.gif)

## Features

### Table Rendering

Tables are rendered as HTML in the markdown editor, allowing you to see the HTML formatted table without using the markdown viewer.

Table rendering includes rendering of inline markdown and image embeds.

> [!note]
> Table rendering can be temporarily disabled by toggling "source mode" via toolbar button or keyboard shortcut.

#### Markdown Rendering

Supports syntax highlighting (while editing) and rendering (cells not being edited) most markdown syntax supported by Joplin:

- Basic formatting: bold/italic/inline code/strikethrough/highlight(==mark==)/underline(++insert++).
- Links (markdown links, autolinks, reference style links).
- Footnotes: Note that footnotes support is very basic. Table cells are rendered in isolation, which breaks markdown-it-footnote's footnote numbering, so the plugin just displays the exact footnote label that's defined in the footnote link (e.g. `[^1]`).
- Embeds (markdown and html image embeds, video embeds when you have joplin's video plugin enabled, youtube links will be rendered as video embed in joplin 3.6.1 or newer).
- Katex (math) - will be rendered, but not syntax highlighted when editing.
- Line breaks (html `<br>` tags, rendered as line breaks while editing).

### Table Editing

Provides table editing from the rendered HTML table similar to the Rich text editor. The following operations are supported:

- Editing table cells (with syntax highlighting for markdown)
- Adding/Deleting/Clearing rows
- Adding/Deleting/Clearing columns
- Moving rows (up/down)
- Moving columns (left/right)
- Changing column alignment (left/center/right)
- Clear table
- Select multiple table cells and cut/copy/paste/clear/delete

> [!note]
>
> The plugin does not provide handling for ctrl + clicking links while editing a table cell. However, you can left click links on table cells that aren't actively being edited, and you can get right click context menu options for links using plugins like Rich Markdown or Context Utils.

## Undo/Redo

Properly supports undo/redo while editing tables (integrated with main editor's undo/redo history).

## Search integration

Table markdown is revealed while joplin search panel is active. When closing search (and if search result selection is in a table), closing search will activate that table cell with the search result highlighted.

### Keyboard Shortcuts

| Action                       | Shortcut                       |
| :--------------------------- | :----------------------------- |
| **Insert Table**             | `Alt + Shift + T`              |
| **Insert Row Above/Below**   | `Alt + Shift + Up` / `Down`    |
| **Insert Column Left/Right** | `Alt + Shift + Left` / `Right` |
| **Delete Row**               | `Alt + Shift + D`              |
| **Clear Row**                | `Alt + Shift + C`              |
| **Delete Column**            | `Ctrl + Alt + Shift + D`       |
| **Clear Column**             | `Ctrl + Alt + Shift + C`       |
| **Move Row Up/Down**         | `Ctrl + Alt + Up` / `Down`     |
| **Move Column Left/Right**   | `Ctrl + Alt + Left` / `Right`  |
| **Align Left/Center/Right**  | `Alt + Shift + Q` / `W` / `E`  |
| **Source Mode**              | `Ctrl + Shift + /`             |

- **Tab/Shift Tab:** Cycle through table cells in order/reverse order. Tab on last row/column will create a new row.
- **Arrow Keys:** Navigate within text in table cell, and navigate to next cell (based on arrow direction) when reaching cell boundary.
- **Enter Key:** Moves to next row, or creates new row on last row.
- **Shift + Enter:** Insert `<br>` (line break).
- **Shift + Click:** Select multiple table cells.
- **Shift + Arrow:** Select multiple table cells.

### Important Notes/Limitations

- Only supports markdown tables (GFM). Doesn't support HTML tables, multi-markdown table extensions, etc...
- Multi-cell selection is keyboard only

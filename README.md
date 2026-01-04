> [!note]
> This plugin was created entirely with AI tools, and I may be limited in my ability to fix any issues.

# Rich Tables

A Joplin plugin to provide table rendering & table editing in the Markdown editor.

![example](https://github.com/user-attachments/assets/0a1755d8-e1a8-4a13-af18-5162acd57b23)

## Features

### Table Rendering

Tables are rendered as HTML in the markdown editor, allowing you to see the HTML formatted table without using the markdown viewer.

Table rendering includes rendering of inline markdown and image embeds.

> [!note]
> Table rendering can be temporarily disabled by toggling "source mode" via toolbar button or keyboard shortcut.

#### Supported markdown syntax for rendered tables

- Basic formatting: bold/italic/inline code/strikethrough/highlight(==mark==)/underline(++insert++).
- Links (markdown links, autolinks, reference style links).
- Footnotes: Note that footnotes support is very basic. Table cells are rendered in isolation, which breaks markdown-it-footnote's footnote numbering, so the plugin just displays the exact footnote number that's defined in the footnote link (e.g. `[^1]`).
- Images (markdown and html image embeds).
- Katex (math) - will be rendered, but not syntax highlighted when editing.
- Line breaks (as html `<br>` tags).

### Table Editing

Provides table editing from the rendered HTML table similar to the Rich text editor. The following operations are supported:

- Editing table cells (with syntax highlighting for markdown)
- Adding/Deleting rows
- Adding/Deleting columns
- Moving rows (up/down)
- Moving columns (left/right)
- Changing column alignment (left/center/right)
- Format table (currently just normalizes whitespace to one space around cell content, no full-on pretty formatting currently).

> [!note]
>
> The plugin does not provide handling for ctrl + clicking links while editing a table cell. However, you can left click links on table cells that aren't actively being edited, and you can get right click context menu options for links using plugins like Rich Markdown or Context Utils.

### Keyboard Shortcuts

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
| **Source Mode**              | `Ctrl + Alt + /`                     |

- **Tab/Shift Tab:** Cycle through table cells in order/reverse order. Tab on last row/column will create a new row.
- **Arrow Keys:** Navigate within text in table cell, and navigate to next cell (based on arrow direction) when reaching cell boundary.
- **Enter Key:** Moves to next row, or creates new row on last row.
- **Shift + Enter:** Insert `<br>` (line break)

### Important Notes/Limitations

- Only supports markdown tables (GFM). Doesn't support HTML tables, multi-markdown table extensions, etc...
- Limited support for multi-line content (you can use shift + enter to add a `<br>` and newlines will be converted to `<br>` for pasted content, but they aren't rendered as line breaks during editing).

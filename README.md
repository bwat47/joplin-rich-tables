> [!note]
> This plugin was created entirely with AI tools, and I may be limited in my ability to fix any issues.

# Rich Tables

A Joplin plugin to provide table rendering & table editing in the Markdown editor.

![example](https://github.com/user-attachments/assets/e16608bf-ec86-4083-b47a-bab0d15e6f9e)

## Features

### Table Rendering

Tables are rendered as HTML in the markdown editor, allowing you to see the HTML formatted table without using the markdown viewer.

Table rendering includes rendering of inline markdown and image embeds.

### Table Editing

Provides table editing from the rendered HTML table similar to the Rich text editor. The following operations are supported:

- Editing table cells
- Adding/Deleting rows
- Adding/Deleting columns
- Changing column alignment (left/center/right)
- Format table (currently just normalizes whitespace to one space around cell content, no full-on pretty formatting currently).

### Important Notes/Limitations

#### Table limitations

- Only supports markdown tables (GFM). Doesn't support HTML tables, multi-markdown table extensions, etc...
- No support for multi-line content (unless you manually enter `<br>` tags)

#### Editing limitations

In order to provide table editing, the plugin uses a nested codemirror editor subview. Because of this, the following limitations are present:

- Keyboard shortcuts are limited when editing table cells (only basics like ctrl +c, ctrl + v, ctrl + z, ctrl +x)

- Formatting functions from joplin's formatting toolbar will not work properly.

- Cell editing is plaintext only (markdown will not be rendered until you leave the cell).

- No context menu when editing cells

# Rich Tables

A Joplin plugin to provide table rendering & table editing in the Markdown editor.

![example](https://github.com/user-attachments/assets/e98b344d-2f76-4070-9bcc-fac1cd05b9a6)

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

#### Mobile limitations

- Table editing is janky on mobile (viewport can jump around while selecting cells). It's not bad with simple tables, but annoying with large tables.
- There's an issue on mobile (android) when the editor has elements that have a horizontal scroll (e.g. a wide table elsewhere in the document), focusing a cell in another table will unnecessarily scroll to the right, looks almost identical to the video in this issue: https://github.com/codemirror/dev/issues/752

#### Editing limitations

In order to provide table editing, the plugin uses a nested codemirror editor subview. Because of this, the following limitations are present:

- Keyboard shortcuts are limited when editing table cells (only basics like ctrl +c, ctrl + v, ctrl + z, ctrl +x)

- Formatting functions from joplin's formatting toolbar will not work properly.

- Cell editing is plaintext only (markdown will not be rendered until you leave the cell).

- No context menu when editing cells

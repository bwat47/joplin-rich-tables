# Rich Tables

A Joplin plugin to provide table rendering & table editing in the Markdown editor.

## Features

### Table Rendering

Tables are rendered as HTML in the markdown editor, allowing you to see the HTML formatted table without using the markdown viewer.

Table rendering includes rendering of inline markdown and image embeds.

<img width="1898" height="1438" alt="image" src="https://github.com/user-attachments/assets/52c453eb-f45b-4615-809c-869f68cf7c33" />

### Table Editing

Provides table editing from the rendered HTML table similar to the Rich text editor. The following operations are supported:

- Editing table cells
- Adding/Deleting rows
- Adding/Deleting columns
- Changing column alignment (left/center/right)

### Important Notes/Limitations

- Only supports markdown tables (GFM). Doesn't support HTML tables, multi-markdown table extensions, etc...
- Table editing is janky on mobile (viewport can jump around while selecting cells). It's not bad with simple tables, but annoying with large tables.
- No support for multi-line content (unless you manually enter `<br>` tags)

In order to provide table editing, the plugin uses a nested codemirror editor subview. Because of this, the following limitations are present:

- Keyboard shortcuts are limited when editing table cells (only basics like ctrl +c, ctrl + v, ctrl + z, ctrl +x)

- Formatting functions from joplin's formatting toolbar will not work properly.

- Cell editing is plaintext only (markdown will not be rendered until you leave the cell).

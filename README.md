> [!note]
> This plugin was created entirely with AI tools, and I may be limited in my ability to fix any issues.

# Rich Tables

A Joplin plugin to provide table rendering & table editing in the Markdown editor.

![example](https://github.com/user-attachments/assets/a68f8de5-7acb-43b8-9e5a-ad81adf8857f)

## Features

### Table Rendering

Tables are rendered as HTML in the markdown editor, allowing you to see the HTML formatted table without using the markdown viewer.

Table rendering includes rendering of inline markdown and image embeds.

### Table Editing

Provides table editing from the rendered HTML table similar to the Rich text editor. The following operations are supported:

- Editing table cells (with syntax highlighting for markdown)
- Adding/Deleting rows
- Adding/Deleting columns
- Changing column alignment (left/center/right)
- Format table (currently just normalizes whitespace to one space around cell content, no full-on pretty formatting currently).

### Important Notes/Limitations

#### Table limitations

- Only supports markdown tables (GFM). Doesn't support HTML tables, multi-markdown table extensions, etc...
- Limited support for multi-line content (you can use shift + enter to add a `<br>` and newlines will be converted to `<br>` for pasted content, but they aren't rendered as line breaks during editing).

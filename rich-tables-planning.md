# Visual Tables Plugin - Architecture & Planning

## Overview

A Joplin plugin that provides a rich table editor in Joplin's CodeMirror 6 markdown editor using a **Block Replacement Widget** strategy combined with a **Restricted Subview** pattern for cell editing.

---

## Architecture

### 1. Block Widget Replacement (✅ Implemented)

The editor does **not** attempt to style Markdown tables in-place. Instead, it completely hides the raw Markdown text and replaces it with a DOM-based `WidgetType`.

**Detection**

- Document is scanned for table-related AST nodes via Lezer syntax tree

**Replacement**

- Entire table range replaced using `Decoration.replace({ widget, block: true })`
- Block decorations provided via `StateField` (required by CM6)

**Selection Awareness**

- Tables with cursor inside are NOT replaced - raw markdown shown for editing
- Moving cursor out triggers widget re-render

### 2. Visual Layer (✅ Implemented)

The `TableWidget` class renders the interactive table UI.

**Rendering**

- Produces standard HTML `<table>` structure with `<thead>` and `<tbody>`
- Respects column alignments from separator row (`:---`, `:---:`, `---:`)

**Markdown in Cells** (✅ Implemented)

- Cell content rendered as HTML via Joplin's `renderMarkup` command
- Async rendering with caching to avoid redundant requests
- Plain text shown initially, updated when render completes

**Styling**

- Light and dark theme support via `EditorView.baseTheme`
- Margins stripped from rendered markdown elements

### 3. Editing (TBD)

## References

- [Joplin Plugin API - Content Scripts](https://joplinapp.org/help/api/tutorials/cm6_plugin/)
- [CodeMirror 6 - Decorations](https://codemirror.net/docs/ref/#view.Decoration)
- [joplin-plugin-extra-editor-settings](https://github.com/personalizedrefrigerator/joplin-plugin-extra-editor-settings) - Reference implementation for CM6 widgets

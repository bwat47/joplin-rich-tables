# Visual Tables Plugin - Architecture & Planning

## Overview

A Joplin plugin that provides a rich table editor in Joplin's CodeMirror 6 markdown editor using a **Block Replacement Widget** strategy combined with a **Restricted Subview** pattern for cell editing.

---

## Architecture

### 1. Block Widget Replacement (✅ Implemented)

The editor does **not** attempt to style Markdown tables in-place. Instead, it completely hides the raw Markdown text and replaces it with a DOM-based `WidgetType`.

**Detection**

- Document is scanned for table-related AST nodes via Lezer syntax tree
- Falls back to regex-based detection if syntax tree doesn't have Table nodes

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

### 3. Editing Layer: The Subview Pattern (🔲 Not Started)

This is the most critical part of the architecture for true WYSIWYG editing.

**Concept**
Using `contenteditable` directly on table cells would make synchronization with the Markdown source extremely difficult. Instead, use **nested CodeMirror instances**.

**Activation**

- Clicking a table cell replaces its static content with a small, embedded CodeMirror editor (the _subview_)

**The "Full Book" Trick**
The subview holds **the entire document state**, not just the cell's text.

- **Why**: Because subview and main editor share identical document structure, line numbers, and offsets, synchronization becomes trivial
- **Illusion**: Despite containing full document, subview hides everything except the active cell using `Decoration.replace` to hide `0 → cellStart` and `cellEnd → docEnd`

**Alternative Approach**
If nested EditorView proves problematic, consider:

- Cell-only state with explicit position mapping
- Controlled `contenteditable` with `beforeinput` event interception
- Modal editing (click cell → dialog with editor → sync on close)

### 4. Synchronization and Data Flow (🔲 Not Started)

Two editors (Main and Subview) active simultaneously requires careful sync to avoid infinite loops.

**Transaction Tagging**

- Dedicated `syncAnnotation` attached to transactions
- Subview → Main: Changes tagged and dispatched to main editor
- Main → Subview: Changes without tag forwarded to subview
- Loop Prevention: If either editor receives transaction with tag, apply locally but don't re-dispatch

**Structural Boundaries**

- Transaction filter (`ensureBoundariesFilter`) enforces table integrity
- Prevents inserting newlines
- Prevents deleting pipe (`|`) characters

---

## Current Implementation Status

### Completed ✅

| Component         | File                                    | Description                                                  |
| ----------------- | --------------------------------------- | ------------------------------------------------------------ |
| Plugin entry      | `src/index.ts`                          | Registers content script, handles `renderMarkup` messages    |
| Content script    | `src/contentScript/tableEditor.ts`      | StateField for table decorations, table detection, styling   |
| Table widget      | `src/contentScript/TableWidget.ts`      | WidgetType that renders tables as HTML with markdown support |
| Markdown renderer | `src/contentScript/markdownRenderer.ts` | Async rendering service with caching                         |
| Logger            | `src/logger.ts`                         | Logging wrapper with prefix                                  |

### Working Features

- [x] Table detection (syntax tree + regex fallback)
- [x] Block widget replacement
- [x] Selection-aware decorations (raw markdown when cursor inside)
- [x] HTML table rendering with proper structure
- [x] Column alignment support
- [x] Markdown rendering in cells (bold, italic, code, links, etc.)
- [x] Render caching
- [x] Light/dark theme support

### Not Started 🔲

- [ ] Cell click handling
- [ ] Nested EditorView (subview) creation
- [ ] Subview hidden decoration field
- [ ] Transaction synchronization (syncAnnotation)
- [ ] Boundary enforcement filter
- [ ] Add row/column UI controls
- [ ] Delete row/column UI controls
- [ ] Keyboard navigation between cells

---

## File Structure

```
src/
├── index.ts                           # Plugin entry, message handling
├── logger.ts                          # Logging utility
└── contentScript/
    ├── tableEditor.ts                 # Main content script, StateField, styles
    ├── TableWidget.ts                 # WidgetType for table rendering
    ├── markdownRenderer.ts            # Async markdown rendering service
    └── (future)
        ├── subview.ts                 # Nested EditorView management
        ├── syncAnnotation.ts          # Transaction tagging for sync
        └── boundaryFilter.ts          # Structural integrity enforcement
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Main CodeMirror Editor                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ EditorState                                              │    │
│  │  └── tableDecorationField (StateField<DecorationSet>)   │    │
│  │       └── provides decorations to EditorView            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ TableWidget (WidgetType)                                 │    │
│  │  ├── toDOM() → creates <table> HTML                     │    │
│  │  ├── renderCellContent() → async markdown rendering     │    │
│  │  └── (future) click handler → spawn subview             │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ markdownRenderer                                         │    │
│  │  ├── renderCache (Map<markdown, html>)                  │    │
│  │  ├── postMessage('renderMarkup') → main plugin          │    │
│  │  └── async callback updates cell innerHTML              │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     Main Plugin (index.ts)                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ onMessage handler                                        │    │
│  │  └── 'renderMarkup' → joplin.commands.execute()         │    │
│  │       └── returns { html: string }                       │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              Future: Subview (Cell Editor)                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ EditorState (Full Document Copy)                         │    │
│  │  ├── hiddenSpanField → hides everything except cell     │    │
│  │  └── boundaryFilter → prevents structural damage        │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Sync Layer                                               │    │
│  │  ├── syncAnnotation tags transactions                   │    │
│  │  ├── Subview → Main: dispatch with tag                  │    │
│  │  └── Main → Subview: forward without tag                │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Next Steps

### Phase 2: Basic Cell Editing

1. **Spike: Nested EditorView**
    - Test creating EditorView inside widget's `toDOM()`
    - Verify it works within Joplin's content script environment

2. **Implement Subview**
    - Create subview with full document state
    - Add hidden decoration field to mask non-cell content
    - Style to appear as simple input

3. **Implement Sync**
    - Create `syncAnnotation`
    - Wire up bidirectional transaction forwarding
    - Add boundary filter

### Phase 3: Table Manipulation

4. **Add Row/Column Controls**
    - UI buttons on table widget
    - Insert/delete operations that modify markdown

5. **Keyboard Navigation**
    - Tab to move between cells
    - Arrow keys
    - Enter to confirm/move down

### Phase 4: Polish

6. **Scroll Stability**
    - Height estimation for block widgets
    - Prevent scroll jumping on decoration changes

7. **Edge Cases**
    - Multi-line cell content
    - Escaped pipes in content
    - Empty cells
    - Malformed tables

---

## Key Technical Decisions

| Decision                          | Rationale                                     |
| --------------------------------- | --------------------------------------------- |
| StateField over ViewPlugin        | CM6 requires block decorations via StateField |
| Full document in subview          | Trivial sync - positions match exactly        |
| Async markdown rendering          | Can't block toDOM(), use callback pattern     |
| Render caching                    | Avoid redundant API calls                     |
| `bodyOnly: true` for renderMarkup | Prevents wrapper div and extra spacing        |

---

## References

- [Joplin Plugin API - Content Scripts](https://joplinapp.org/help/api/tutorials/cm6_plugin/)
- [CodeMirror 6 - Decorations](https://codemirror.net/docs/ref/#view.Decoration)
- [joplin-plugin-extra-editor-settings](https://github.com/personalizedrefrigerator/joplin-plugin-extra-editor-settings) - Reference implementation for CM6 widgets

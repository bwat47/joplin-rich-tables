# ADR-002: Nested CodeMirror Subview vs Contenteditable

## Status

Accepted

## Context

In-cell editing requires allowing users to edit text inside table cells rendered as HTML widgets. Two primary approaches exist:

1. **Contenteditable**: Make `<td>` elements directly editable via `contenteditable="true"`.
2. **Nested CodeMirror**: Spawn a separate CodeMirror instance inside the cell.

## Decision

Use a nested CodeMirror instance for in-cell editing.

## Consequences

**Positive:**

- Full CodeMirror feature set: syntax highlighting, keymaps, extensions, undo/redo integration.
- Markdown-aware editing with proper escaping and formatting.
- Selection sync allows Joplin's native toolbar (Bold, Italic, Link) to work seamlessly.
- Undo/redo can be unified with the main editor's history.

**Negative:**

- More complex synchronization logic required between main and nested editors.
- Additional memory overhead (full CodeMirror instance per active cell).
- Must handle focus management carefully to avoid race conditions.

## Alternatives Considered

1. **Contenteditable `<td>`**: Inconsistencies with selection, cursor behavior, paste handling, and IME composition compared to main CodeMirror editor.
2. **Single shared editor with clipping**: Rejected—CodeMirror doesn't natively support rendering a subset of the document in a detached DOM location.

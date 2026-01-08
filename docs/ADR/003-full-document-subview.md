# ADR-003: Subview Contains Entire Document State

## Status

Accepted

## Context

The nested editor could be initialized with:

1. **Cell content only**: A minimal document containing just the cell's text.
2. **Entire document**: Full document state, with view clipped to only show the cell range.

## Decision

The nested editor contains the **entire document** state but is configured to clip/narrow its view to only display the active cell range.

## Consequences

**Positive:**

- **Simplified synchronization**: Changes in the nested editor map 1:1 to main document positions. No offset translation needed.
- **Undo/redo coherence**: The main editor owns history. Nested transactions can be forwarded directly without position remapping.
- **Selection sync**: Nested selection ranges directly correspond to main document ranges, enabling Joplin toolbar integration.
- **Context preservation**: Document-level state (e.g., reference definitions for links) is available for rendering and editing.

**Negative:**

- Memory overhead: Full document stored in nested editor state.
- Requires `transactionPolicy` and `mainEditorGuard` to enforce cell boundary (prevent edits outside cell range).
- Initial sync must copy entire document, not just cell content.

## Alternatives Considered

1. **Cell-content-only subview**: Rejected—would require:
    - Offset translation for all position-based operations.
    - Separate undo history or complex remapping for unified history.
    - Re-injection of document context (reference definitions) on every edit.
    - Selection sync would require constant offset calculations.

    The complexity of offset management outweighs the memory savings, especially since only one nested editor is active at a time.

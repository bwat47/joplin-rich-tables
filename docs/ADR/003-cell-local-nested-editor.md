# ADR-003: Cell-Local Nested Editor

## Status

Accepted

Supersedes `003-full-document-subview.md`.

## Context

The nested editor previously mirrored the entire document and hid everything outside the active cell.

That approach kept root and nested positions aligned, but it pushed complexity into:

- range-clipping state and decorations
- whole-document sync into the nested editor
- cell-boundary enforcement to stop accidental edits outside the active cell
- editing behavior that still exposed serialized Markdown forms such as `<br>`

The refactor goal changed the tradeoff:

1. simplify nested-editor implementation and synchronization
2. make line breaks edit as real line breaks inside the cell editor
3. keep the main editor authoritative for history and structural table state

## Decision

The nested editor now owns only the active cell's local text and local selection.

The root document remains authoritative. The session layer translates between:

- local display text and selection in cell-local coordinates
- root table cell text and selection in document coordinates

Local edits are sanitized before they are forwarded to the main editor:

- newlines become `<br>`
- unescaped pipes become `\|`

Root-owned changes are resolved back to the logical active cell and then rebased into the isolated editor.

## Consequences

**Positive:**

- Nested editor state is smaller and matches what the user is editing.
- Cell editing can display real line breaks instead of serialized `<br>`.
- The old clipped-subview machinery is removed.
- Synchronization logic is concentrated in the active-cell session layer instead of split across subview range infrastructure.

**Negative:**

- Selection and text now require explicit local/root translation.
- The session layer must re-resolve the logical active cell after root changes.
- Toolbar and context-menu actions still depend on mirroring selection into the main editor.

## Alternatives Considered

1. **Whole-document nested editor with clipped rendering**: Rejected.

    It preserved 1:1 coordinates, but the surrounding infrastructure stayed too complex for the value it provided and it blocked the desired editing experience for line breaks.

# Nested editor table editing plan (Subview pattern)

## Goal

Enable **in-table cell editing** for rendered tables by embedding a single nested CodeMirror editor (the **subview**) inside the active table cell, while keeping the main document as the source of truth.

This plan assumes the current rendering strategy stays the same: tables are rendered via a `WidgetType` and raw Markdown is hidden with a block `Decoration.replace` (except when editing).

## Constraints / non-goals

- No contenteditable-based editing.
- One active cell editor at a time.
- Keep Markdown table syntax structurally valid.

## Current relevant code

- Rendering widget: `src/contentScript/TableWidget.ts`
- Decorations / selection-aware replacement: `src/contentScript/tableWidgetExtension.ts`
- Rendering markdown in cells (async, cached): `src/contentScript/markdownRenderer.ts`

## Core approach

### A. Subview activation

- Clicking a table cell (`<td>` or `<th>`) activates an editor embedded in that cell.
- Activation stores a single **active cell range** in document coordinates: `{ from, to }`.
- Only one subview exists at a time. Activating a new cell destroys the old subview.
- Deactivation happens on blur, Escape, or clicking outside the table.

### B. “Full book” document strategy

The subview uses an `EditorState` whose `doc` is identical to the main editor’s `state.doc`.

Why:

- The active cell range is expressed in the same coordinate system in both editors.
- Forwarding transactions becomes “apply the same change spec”.

### C. Hide everything except the active cell

The subview is visually constrained to look like a cell editor, but it contains the full document.

Mechanism:

- A `hiddenSpanField` decoration set hides everything outside the active cell range.
- Use `Decoration.replace` to replace:
    - `[0, cellFrom)`
    - `[cellTo, docEnd)`

Additional styling ensures the subview looks like a small input area (no gutters, minimal padding, transparent background).

## Suggested small adjustments (recommended)

These are specifically to avoid UX and correctness pitfalls.

1. **Single active subview**
    - Enforce at most one nested editor instance at a time.
    - Keeps performance predictable and avoids multiple competing sync loops.

2. **Main editor owns history**
    - Subview transactions should generally be dispatched to main with history enabled.
    - Subview applies changes with `addToHistory: false` (or equivalent) and re-syncs from main.
    - This prevents two diverging undo stacks.

3. **Strict range enforcement (not just “pipes/newlines”)**
    - Any subview transaction that changes text _outside_ `[cellFrom, cellTo]` is rejected or transformed.
    - This avoids pastes/multi-cursor edits accidentally touching hidden regions.

4. **Pipe handling via escaping, not blocking**
    - Do not forbid typing `|`.
    - Transform inserted `|` into `\|` inside cells so the Markdown table structure stays intact.
    - (Optional future: also handle `\\|` correctly and avoid double-escaping.)

5. **Newline policy (start simple)**
    - Phase 1: block newlines in-cell (reject transactions inserting `\n`).
    - Phase 2 (optional): allow newlines by converting to `<br>` or `<span>` representation, but only if the table parser/rendering supports it end-to-end.

6. **Remap active cell range through main changes**
    - When main editor applies any change, update `{ cellFrom, cellTo }` via position mapping (e.g. `tr.changes.mapPos`).
    - Then update subview hide-decorations to keep the correct visible cell.

## Implementation phases

### Phase 1 — Represent “active cell” in editor state

Add a small state layer (state field or facet) to represent the active cell.

- Data: `{ tableFrom, tableTo, cellFrom, cellTo, rowIndex, colIndex }` (indices optional but useful)
- Stored in the **main** editor state.
- Updated via explicit effects (e.g. `setActiveCellEffect`, `clearActiveCellEffect`).

Where:

- New module recommended: `src/contentScript/activeCellState.ts`
- Registered from `src/contentScript/tableWidgetExtension.ts`

Exit criteria:

- You can toggle an “active cell” range from widget click, and clear it on demand.

### Phase 2 — Click mapping: DOM cell → doc range

When user clicks a rendered cell, map it to the corresponding Markdown cell text range in the source.

Work needed:

- Extend `parseMarkdownTable(...)` (or add a new parser) to return **cell offsets** in the original table text.
- Convert cell offsets in table-local coordinates into doc coordinates using `tableFrom`.

Where:

- Likely updates in `src/contentScript/TableWidget.ts` and the table parser helpers in that same file.

Exit criteria:

- Clicking a cell yields stable `{ cellFrom, cellTo }` doc coordinates.

### Phase 3 — Create/destroy the subview inside the widget

Embed a nested `EditorView` inside the clicked cell.

Behavior:

- On activation: create subview, attach to cell element.
- On deactivation: destroy subview and restore static rendering.

Where:

- New module recommended: `src/contentScript/nestedCellEditor.ts` (Subview manager)
- `TableWidget.toDOM(...)` wires click handlers and hosts the mount point.

Exit criteria:

- Subview appears inside the cell and accepts input.

### Phase 4 — Hide-outside-range decorations in subview

Add a decoration field to the subview that replaces everything outside the active cell range.

Where:

- `src/contentScript/nestedCellEditor.ts`

Exit criteria:

- Only the active cell content is visible in the subview.

### Phase 5 — Synchronization + loop prevention

Implement bidirectional sync between subview and main.

Mechanics:

- Define `syncAnnotation`.
- **Subview → Main**: forward transactions originating from subview (tagged).
- **Main → Subview**: forward main changes that do _not_ have `syncAnnotation`.
- If a transaction arrives with `syncAnnotation`, apply locally and do not re-dispatch.

History recommendation:

- Main editor: normal history.
- Subview: `addToHistory: false` for forwarded edits, and rebase from main.

Where:

- New plugin recommended: `src/contentScript/subviewSyncPlugin.ts` (or keep inside `nestedCellEditor.ts` if small)

Exit criteria:

- Typing in subview updates main document correctly.
- External changes in main (e.g. typing elsewhere or commands) update subview.
- No infinite loops.

### Phase 6 — Boundary filters (integrity enforcement)

Add a transaction filter on the subview to keep edits safe.

Rules:

1. Reject any changes touching outside `[cellFrom, cellTo]`.
2. Reject insertion of `\n`.
3. Transform inserted `|` → `\|` within the changed range.

Where:

- Subview extensions in `src/contentScript/nestedCellEditor.ts`

Exit criteria:

- Paste and typing cannot break table structure.
- Pipes can still be entered (escaped).

### Phase 7 — UX polish (minimal)

- Escape: closes editor and keeps focus in main.
- Enter/Tab behavior (keep minimal):
    - Phase 1: Enter does nothing (newline blocked).
    - Phase 2: Tab moves to next cell (optional; only if you want spreadsheet-like flow).

Where:

- `nestedCellEditor.ts`

Exit criteria:

- Editing feels stable and predictable.

## Validation checklist (manual)

- Click cell → subview opens in that cell.
- Type text, backspace, paste → main markdown updates.
- Undo/redo in main behaves sensibly (doesn’t require “two undos”).
- Typing `|` yields `\|` in markdown.
- Attempt to insert newline is blocked.
- Click outside or press Escape → subview destroyed.
- Large note: activation doesn’t freeze the UI noticeably (one active subview only).

## Notes / future options

- Performance: if “full book” becomes too heavy for huge notes, a fallback is a “cell-only doc” subview with a mapping layer, but that’s explicitly not the initial plan.
- Multi-line cells: only safe if the markdown table parser + renderer reliably support it; otherwise keep newline-blocking.

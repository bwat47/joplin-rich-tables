# ADR-003: Global Source Mode Instead of Cursor-Based Markdown Reveal

## Status

Accepted

## Context

Rich table editing requires a way for users to view and edit raw markdown. Two approaches were considered:

1. **Cursor-based reveal**: Automatically show raw markdown for the table (or row/cell) near the cursor position, switching back to rendered view when the cursor moves away.

2. **Global source mode**: A toggle that switches **all** tables between rendered widgets and raw markdown.

### Problems with Cursor-Based Reveal

- **Fragile logic**: Detecting cursor proximity to tables, handling edge cases (cursor at boundaries, selections spanning multiple tables), and managing transitions is complex and error-prone.
- **Complicated code**: The widget system must constantly track cursor position and conditionally render, leading to intricate state management.
- **Inconsistent UX**: Users may find it jarring when tables "flicker" between modes as they navigate.

### Search Highlighting Requirement

CodeMirror's native search uses the `@codemirror/search` module, which highlights matches in the **raw document text**. When tables are rendered as replacement widgets, the underlying markdown is hidden from view—search highlights cannot be displayed within the widget's rendered HTML.

Attempts to re-implement search highlighting inside custom table widgets would require:

- Intercepting search state
- Parsing the search query
- Manually applying highlights to rendered cell content
- Keeping highlights in sync with search navigation

This duplication is fragile and unnecessary.

## Decision

Implement **global source mode** as an explicit, document-wide toggle:

1. **User-controlled source mode** (`sourceModeField`): A toggle command that switches all tables to raw markdown. Useful for debugging, manual edits, or when rendered formatting is problematic.

2. **Search-forced source mode** (`searchForceSourceModeField`): Automatically activates when the search panel opens, forcing all tables to raw markdown so CodeMirror's native search highlighting works correctly. Deactivates when the search panel closes.

3. **Effective raw mode** (`isEffectiveRawMode()`): Returns `true` if either source mode is active. The widget extension uses this to decide whether to render widgets or show raw markdown.

### Implementation Files

- `sourceMode.ts`: User-controlled toggle, StateField + effects
- `searchForceSourceMode.ts`: Search-triggered StateField + effects
- `searchPanelWatcher.ts`: ViewPlugin that detects search panel open/close and dispatches effects

## Consequences

**Positive:**

- Simple, predictable behavior—all tables are either rendered or raw, never mixed.
- Search highlighting works natively without custom implementation.
- Cleaner code with less state management complexity.
- Easy to reason about and debug.

**Negative:**

- Users cannot view raw markdown for just one table while others remain rendered.
- Toggling source mode affects the entire document, which may be unexpected for users editing one specific table.

## Alternatives Considered

1. **Cursor-based markdown reveal**: Rejected—logic is fragile, complicates codebase, and creates inconsistent UX.
2. **Custom search highlighting in widgets**: Rejected—duplicates CodeMirror functionality, high maintenance burden, difficult to keep in sync with native search behavior.
3. **Per-table source mode toggle**: Considered but deferred—would require additional UI (e.g., per-table button) and state tracking, with limited benefit over global toggle.

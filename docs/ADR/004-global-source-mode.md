# ADR-004: Global Source Mode Instead of Cursor-Based Markdown Reveal

## Status

Accepted

## Context

Rich table editing requires a way for users to view and edit raw markdown. Two approaches were considered:

1. **Targeted table reveal**: Keep tables rendered by default, but allow raw markdown to be shown for the table at the current cursor position (using atomic ranges to prevent table from being revealed simply by moving the cursor into it). In the pre-source-mode implementation, this was primarily triggered by the existing "edit as markdown" toolbar button.

2. **Global source mode**: A toggle that switches **all** tables between rendered widgets and raw markdown.

### Problems with Targeted Table Reveal

- **Fragile targeting logic**: Revealing the correct table required deriving widget-vs-markdown state from the main editor cursor and selection, with exceptions for active tables, note restore, undo/redo, search transitions, and touch interactions.
- **Complicated code**: The widget system had to coordinate explicit reveal actions with selection-driven editor state. Cursor movement and selection restoration in unrelated editor flows could force table widgets to disappear or reappear unless each case was handled explicitly.
- **Inconsistent UX**: The main editing flow did not reveal markdown just because the user moved the cursor into a table, but the implementation still depended on cursor position to decide whether a table should stay rendered. That made behavior around search, history, and restored cursor positions harder to predict.

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

- The previous per-table "edit as markdown" behavior is removed in favor of a document-wide toggle.
- Toggling source mode affects the entire document, which may be unexpected for users editing one specific table.

## Alternatives Considered

1. **Targeted markdown reveal for the table at the cursor**: Rejected. The plugin already had a per-table reveal button, backed by logic to reveal the table containing the current cursor. Even after the earlier drag-selection flicker was mitigated using atomic ranges, this model still required fragile cursor- and selection-driven rules across startup, note restore, undo/redo, search, and other editor transitions.
2. **Custom search highlighting in widgets**: Rejected—duplicates CodeMirror functionality, high maintenance burden, difficult to keep in sync with native search behavior.
3. **Keep or expand the existing per-table reveal control**: Rejected in favor of a single global mode. The plugin already had a per-table toolbar button, but extending that approach would preserve the same cursor/selection-coupled targeting and synchronization complexity that source mode was meant to remove.

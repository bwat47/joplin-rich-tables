# Table Display

The main editor document remains the source of truth. Display turns indexed root tables into interactive widgets while keeping raw Markdown available when rendering is disabled or parsing is incomplete.

## Rendering Pipeline

`tableDecorationField` reads `tableContextField` and replaces each indexed table source span with a block `TableWidget`. It owns decoration updates; the widget renders the table and maps interactions back to cells. Inactive cell Markdown is rendered through the service described in [Markdown-Rendering.md](./Markdown-Rendering.md).

Document changes rebuild decorations from the current index. The active table's widget can stay mounted when the change is confined to the active cell, or sits entirely outside that table and is not an undo or redo. A cell switch inside the same table can keep it too, but only when the current index still has the same span, the same shape, and a resolvable active cell. An edit that touches the rest of the table rebuilds the widget. Other widgets can reuse their DOM when their source text is unchanged. These are display optimizations: active-cell identity and current cell offsets still come from editor state and `TableContext`, never from widget DOM. See [Table-Runtime-Invariants.md](./Table-Runtime-Invariants.md) for the lifecycle rules.

When the table index is incomplete, its decorations disappear and source Markdown is shown. Rendering returns on a later update once a complete syntax tree is available; background parsing is not guaranteed to finish immediately. The widget estimates table height before rendering and records measured height afterward to reduce scroll jumps. It also maps positions inside replaced source to rendered cell coordinates for editor features such as tooltips.

## Raw Display Modes

Explicit source mode reveals Markdown for the whole document. Opening CodeMirror search temporarily uses the same raw display so matches inside tables are visible. Both modes remove table widgets and close an active nested editor; leaving search restores rendered tables unless explicit source mode is still enabled. See [ADR-004](../ADR/004-global-source-mode.md) for the source-mode decision.

Find next/previous (F3, Mod-g) also runs with the search panel closed, while tables stay rendered. A match wholly inside one cell opens that cell with the match selected (`searchMatchCellEntry.ts`); any other match inside a table selects the whole table. A cell editor routes the search chords to the root editor, and opening the panel closes the cell editor.

## Layout and Appearance

Wide tables scroll within their widget. Table styles constrain cell media and embeds, and optional zebra striping applies only to widget-owned rows. Text selection remains visible across rendered cells and the active nested editor.

Viewport handling supports Joplin's internally scrolling desktop editor and document-scrolling mobile or web editor. The floating toolbar and cell-drag scrolling use the visible viewport bounds so they remain positioned around the table in either host layout.

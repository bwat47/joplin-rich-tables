# Interaction and Navigation

The main editor owns the document, history, and table-level selections. A temporary nested editor owns text interaction inside the active cell. The table runtime moves between these scopes, while the widget displays active cells and selections.

## Moving Through Tables

Rendered tables replace their Markdown source with block widgets, so ordinary main-editor caret movement cannot pass directly through them. Entering from the surrounding document opens an edge cell; leaving a table closes the nested editor and returns the caret and focus to the main editor.

Within a table, Tab moves to the next cell, and from the last cell it adds a row. Enter moves to the cell below and can add a row after the last row. Left and right arrows leave a cell at the start or end of its text; up and down arrows leave it from the first or last visual line. At a table boundary those arrows return to the main editor. Navigation records the logical destination and requested caret placement in an explicit open request; the lifecycle resolves current document positions when the nested editor mounts. See [Nested-Editor-Architecture.md](./Nested-Editor-Architecture.md) for that handoff.

## Selection Scopes

- **Inside a cell:** The nested editor owns the visible text selection and mirrors it to the main editor for document commands and Joplin toolbar actions.
- **Across cells:** A rectangular selection lives in main-editor state and is drawn by the widget. Keyboard navigation, deletion, clipboard operations, and undo use main-editor state. Pasting a table fragment can fill the selection or expand the table.
- **Whole table:** A main-editor range that reaches a rendered table expands to include the full table block. Row and column selection remain part of the rectangular cell-selection mode.

Mouse dragging can select text within one rendered cell or promote the gesture to a rectangular selection when it crosses into another cell. The [runtime invariants](./Table-Runtime-Invariants.md#cell-drag-ownership) define which state owns an active drag. Clipboard rewrites are described in [Structural-Commands-and-Serialization.md](./Structural-Commands-and-Serialization.md).

## Pointer Mapping and External Actions

A click on rendered cell text, other than a link, opens the nested editor at the matching position in the cell's Markdown. Because rendered HTML has no source offsets, the interaction layer projects the clicked text into cell-local coordinates and carries the result with the open request. If the text cannot be matched reliably, the open request keeps the main editor's current selection.

Links open through Joplin's `openItem` command, while heading and footnote anchors scroll the main editor. Dragging near an edge can scroll the table or its host viewport; [Table-Display.md](./Table-Display.md) describes the host layouts.

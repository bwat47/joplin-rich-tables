# Interaction and Navigation

The main editor owns document state, history, and table-level selections. A transient nested editor owns interaction
inside the active cell. The table runtime coordinates transitions between them, while the widget renders interaction
state.

## Ownership

| Area                    | Owner                                             | Responsibility                                                           |
| :---------------------- | :------------------------------------------------ | :----------------------------------------------------------------------- |
| Main-editor entry       | `tableRuntime/navigation/mainEditorTableEntry.ts` | Opens an edge cell when the caret moves into a rendered table.           |
| Cell activation         | `tableRuntime/openCellRequest.ts`                 | Stores logical open intent until the widget and nested editor are ready. |
| Nested-editor lifecycle | `tableRuntime/lifecycle/nestedEditorLifecycle.ts` | Resolves document positions and mounts or closes the cell editor.        |
| Table exit              | `tableRuntime/navigation/tableExit.ts`            | Returns the caret and focus to the main editor.                          |
| Selection state         | `tableRuntime/selection/` and `tableState/`       | Owns multi-cell and whole-table selection behavior.                      |
| Interaction visuals     | `tableWidget/`                                    | Renders active cells, selection rectangles, and whole-table selection.   |

## Cell Navigation

The active cell contains a nested editor; inactive cells remain table elements. Navigation makes these separate editors
behave like one grid.

| Key                 | Action            | Boundary behavior                                     |
| :------------------ | :---------------- | :---------------------------------------------------- |
| **Tab**             | Next cell         | Creates a row after the final cell.                   |
| **Shift+Tab**       | Previous cell     | Stops at the first cell.                              |
| **Enter**           | Cell below        | Creates a row after the final row.                    |
| **ArrowLeft/Right** | Move horizontally | Crosses into an adjacent cell or exits the table.     |
| **ArrowUp/Down**    | Move vertically   | Crosses at a visual line boundary or exits the table. |

Because a rendered table replaces its Markdown source as a block decoration, normal caret movement cannot enter or
exit it directly:

- Entry from the main editor opens the nearest edge cell. It applies only to an empty caret in rendered mode when no
  cell selection is active.
- Exit closes the nested editor, places the main-editor caret on the adjacent line, and restores main-editor focus.
- The required blank-line separation around tables is maintained by
  `tableRuntime/tableBoundaryMaintenance.ts` as part of the triggering transaction.

Opening a cell can span document changes, widget rendering, and nested-editor mounting. The runtime therefore records
the logical target and caret placement in editor state, then resolves current document positions when mounting. Cell
navigation, table entry, row creation, and structural commands all use this request path.

## Selection Architecture

The interaction model has three selection scopes:

### In-Cell Selection

The nested editor owns the visible text selection inside the active cell. It mirrors that selection into main-editor
coordinates so document commands and Joplin toolbar actions continue to work. Cross-editor transactions use
`syncAnnotation` to prevent feedback loops.

### Multi-Cell Selection

A rectangular cell selection is stored in main-editor state and rendered by the table widget. The main editor owns
keyboard, clipboard, and history commands while this mode is active.

- **Shift+Arrow** starts or extends the rectangle.
- **Arrow** collapses the selection and exits the table; **Enter/Tab** activates the focus cell.
- **Escape** clears the selection.
- **Delete/Backspace** clears content or removes fully selected empty structures.
- **Copy/Cut/Paste** operates on the rectangle and may expand the table.
- **Undo/Redo** uses main-editor history.

Paste sizes itself to the selection: `tableModel/clipboardFragmentTiling.ts` repeats the clipboard fragment across the
rectangle from its top-left, writing only whole repetitions. A single copied cell therefore fills the rectangle, and a
2x2 fragment covers 4x4 of a 5x5 rectangle, leaving the trailing row and column untouched. The post-paste selection
covers the region actually written, so a rectangle that was not an exact fit shows the shortfall. A fragment larger
than the rectangle still pastes one complete copy and may expand the table. An open nested editor owns its own cell and
always pastes anchored there.

Clipboard text that is not a table fills the selection as a single cell value, with line breaks and pipes sanitized so
they cannot break the row.

Mouse dragging can also create a rectangular selection. Drag ownership and deferred active-cell updates are described
in [Table-Runtime-Invariants.md](./Table-Runtime-Invariants.md#cell-drag-ownership).

### Whole-Table Selection

A main-editor range that reaches a rendered table expands to cover the entire table block. Rows and columns remain the
responsibility of multi-cell selection.

`tableRuntime/selection/tableSelectionSnap.ts` owns range expansion, while
`tableWidget/wholeTableSelectionVisuals.ts` renders the selected block. Whole-table and multi-cell selections share
the same cell-selection tint; their extent distinguishes them.

Moving the main-editor caret outside the selected table clears table-owned selection state.

## Click-to-Caret Placement

A click on a rendered cell opens it with the caret at the clicked point in the Markdown source, so clicking inside a
bolded word lands between the same two letters once the syntax is visible.

The rendering service returns HTML without character offsets. Placement therefore combines DOM hit testing with
CodeMirror's Markdown syntax tree:

1. `tableWidget/cellCaretHit.ts` reads the DOM caret before the rendered content is replaced.
2. `tableRuntime/interaction/cellTextProjection.ts` projects visible source spans into text with a map back to
   nested-editor offsets, so hidden Markdown cannot become an anchor.
3. `tableRuntime/interaction/clickCursorPlacement.ts` maps matching rendered/projected text directly.
4. When rendering transforms the text, `shared/textAlignment.ts` aligns rendered text against the projection under a
   bounded budget. Unknown renderer extensions remain approximate; insufficient matches decline placement.

The offset or range travels through the open-cell request to the nested editor.

Every press inside a widget is routed by `tableWidgetPressPlugin` in `tableWidget/tableWidgetInteractions.ts`, which
returns one of three dispositions: left native, claimed from CodeMirror with the browser default intact, or consumed
outright. It runs in the capture phase because `EditorView.domEventHandlers` cannot express the middle one.

A press on a rendered cell is consumed, and the gesture draws the DOM selection itself from the caret each pointer
move hit-tests. The browser latches its own selection drag at mousedown, and nothing cancels it afterwards: left
native, its auto-scroll keeps running once the gesture has become a cell rectangle, carrying the editor past the
table. Pointerup maps both endpoints through one projection/alignment, preserving direction. A range is mapped from the characters it covers rather than as two carets,
so Markdown syntax is included where the selection spans it and excluded at both ends otherwise, with paired markers
kept balanced. Unresolved hits preserve the established selection fallback.

Crossing into another cell after the movement threshold promotes the gesture to rectangular selection, clears rendered
text selection, and suppresses it until release or cancellation. Returning to the anchor keeps rectangular mode; it
does not restore the earlier text range. Active-editor drags retain their existing boundary margin and behavior.

Only another cell promotes a drag; leaving the table keeps the gesture a text selection, with an endpoint outside the
cell clamped to the end the drag left by. Once a rectangle is being dragged, a pointer outside the table tracks the
nearest cell as before.

## Pointer, Links, and Scrolling

- Clicking activates a cell or updates the current cell selection, placing the caret where the click landed.
- Mouse dragging within an inactive cell selects rendered text; dragging into another cell selects a rectangle.
  Touch and pen input retain native scrolling and tap behavior.
- A long press on mobile selects rendered text without opening the cell. `TableWidget.ignoreEvent` disowns the `copy`
  that follows, so the browser copies what was selected rather than CodeMirror's own document selection. A
  whole-table selection keeps its Markdown copy: its endpoints are not inside a cell.
- Drags near an edge auto-scroll the table or host scroll container. See
  [Table-Display.md](./Table-Display.md#host-scroll-modes).
- Links delegate to the content-script link opener and then to the main plugin.
- Heading and footnote anchors scroll the main editor through `scrollToAnchor`.
- Cell activation relies on nested-editor focus to reveal the target. Table exit, cell-selection movement, anchor
  jumps, and raw-mode cursor movement scroll explicitly.

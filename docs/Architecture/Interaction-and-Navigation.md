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

Joplin's `renderMarkup` cannot help with this: its source map (`MdToHtml/rules/source_map.ts`) annotates block-level
tokens with line numbers only, and a cell is one line. The mapping is instead recovered by aligning text.

1. `tableWidget/cellCaretHit.ts` hit-tests the press against the rendered content and flattens that content into the
   text a reader sees, counting `<br>` as the newline it stands for and skipping MathML, whose text transcribes the
   formula rather than its source.
2. `shared/textAlignment.ts` aligns that text against the cell's own text. Rendering only removes characters, so the
   rendered text is a subsequence of its source for the inline constructs cells contain. Alignment uses `difflib`'s
   recursive longest-matching-block scheme rather than a plain LCS, which is free to scatter its matches across a
   URL or a repeated word. Matches outside probable raw-HTML tokens win ties, preventing visible text from mapping
   into a tag or attribute; unrestricted matching remains available for tag-shaped text rendered literally.
3. `tableRuntime/interaction/clickCursorPlacement.ts` converts the aligned offset into an `InitialCursorPos`.

The press is read at pointerdown, before the open request replaces the rendered content, and carried on the gesture
until the release proves it was a click rather than a drag.

Substitutions that are not subsequences (`&amp;` to `&`, emoji shortcodes, KaTeX) leave a gap the alignment steps
over; because each gap is bounded by the blocks around it, the damage stays local. A caret landing in one resolves to
the nearest anchor, and a cell whose rendered text is mostly gaps abandons the placement and mirrors the main
editor's selection, which is what every unplaced entry has always done.

## Pointer, Links, and Scrolling

- Clicking activates a cell or updates the current cell selection, placing the caret where the click landed.
- Mouse dragging selects a cell rectangle; touch and pen input retain native scrolling and tap behavior.
- Drags near an edge auto-scroll the table or host scroll container. See
  [Table-Display.md](./Table-Display.md#host-scroll-modes).
- Links delegate to the content-script link opener and then to the main plugin.
- Heading and footnote anchors scroll the main editor through `scrollToAnchor`.
- Cell activation relies on nested-editor focus to reveal the target. Table exit, cell-selection movement, anchor
  jumps, and raw-mode cursor movement scroll explicitly.

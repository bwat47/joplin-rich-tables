# Interaction and Navigation

The main editor owns document state and history, while a transient nested editor owns interaction inside the active
cell. Navigation coordinates the handoff between those editors and the table widget's multi-cell selection mode.

## Keyboard Navigation

The active cell hosts a separate editor instance, while inactive cells remain ordinary `<td>` or `<th>` elements. Key
handling makes the cells behave like a single grid.

| Key                 | Action        | At the cell boundary                                               |
| :------------------ | :------------ | :----------------------------------------------------------------- |
| **Tab**             | Next cell     | The final cell creates a row.                                      |
| **Shift+Tab**       | Previous cell | The first cell is blocked.                                         |
| **Enter**           | Cell below    | The final row creates a row.                                       |
| **ArrowLeft/Right** | Move by char  | A cell edge moves horizontally; a table edge exits the table.      |
| **ArrowUp/Down**    | Move by line  | A visual line edge moves vertically; a table edge exits the table. |

### Crossing the Table Boundary

A rendered table is a block replacement in the main editor, so entry and exit must be handled explicitly rather than
by normal caret movement.

- **Entry**: Arrow or deletion movement toward an adjacent table opens the nearest edge cell. Vertical entry preserves
  the expected visual direction by choosing the first or last row as appropriate.
- **Exit**: Arrow movement beyond the outermost cell closes the nested editor, places the main-editor caret on the
  adjacent line, and restores main-editor focus. At a document edge, where no adjacent line exists, the movement is
  blocked.
- **Separation**: The blank line required between a rendered table and neighbouring content is protected from
  incidental deletion. Ordinary typing or pasting into that boundary restores valid separation in the same main-editor
  transaction, keeping the document valid and undo behavior atomic. Composition input is left unchanged and repaired
  on a later cell entry.
- **Eligibility**: Arrow entry applies only to a single empty caret in rendered mode when no cell selection is active.
  Explicit range edits remain main-editor operations.

`tableRuntime/navigation/mainEditorTableEntry.ts` owns entry from the main editor, while
`tableRuntime/navigation/tableExit.ts` owns exit from a nested editor. Boundary-preserving document edits are handled
by `tableRuntime/tableBoundaryMaintenance.ts`.

### Navigation Requests

Opening a cell spans a main-editor transaction, widget rendering, and nested-editor mounting. The pending intent is
therefore stored in editor state (`tableRuntime/openCellRequest.ts`) rather than module-global state. A request records
the logical target and desired caret placement; the lifecycle resolves current document positions when it mounts the
nested editor and then completes or fails the request.

Cell navigation, table entry, row creation, and structural operations share this request path. This keeps document
changes, active-cell state, and reopen intent coordinated.

### Scrolling

Opening a target cell relies on focusing its nested editor, allowing the browser to reveal it naturally. Other paths
scroll explicitly, including table exit, multi-cell selection movement, anchor jumps, and raw-mode cursor visibility.

## Selection Modes

### Active-Cell Selection Sync

While a nested editor is active, its visible selection is mirrored into the hidden main-editor selection. The main
editor remains the integration point for document commands and Joplin toolbar actions. Cross-editor synchronization
must use `syncAnnotation` to avoid feedback loops.

### Multi-Cell Selection

Multi-cell selection is stored in main-editor state and rendered on the table widget rather than being owned by the
nested editor. The main-editor caret tracks the focus cell for clipboard and command integration, but is hidden while
the rectangular selection is visible.

- **Shift+Arrow** starts or extends the selection.
- **Arrow** collapses the selection and leaves the table; **Enter/Tab** activates its focus cell.
- **Escape** clears the selection.
- **Delete/Backspace** clears selected content, or removes fully selected empty rows, columns, or the whole table.
- **Copy/Cut/Paste** operates on the selected rectangle and may expand the table when pasting.
- **Undo/Redo** is forwarded to main-editor history.

Commands that move the main-editor caret outside the selected table clear the selection.

The selected rectangle is painted with the same fill as a whole-table selection (see below), because
both are a selection over rendered cells and telling them apart by colour would say nothing useful.
What distinguishes them is their extent: a cell selection stops at the rectangle, while a whole-table
selection also floods the widget's own block.

Creating a selection also hands focus to the main editor, which owns its keyboard and clipboard
commands. Every gesture that starts one suppresses the browser's own focusing — shift-click
preventDefaults its mousedown, and a keyboard selection tears down the nested editor that held focus
— so without this focus would sit on the document body, and the selection would render as unfocused.
A running drag is the exception: it keeps its anchor cell's editor open for the length of the
gesture and hands focus over on release.

### Whole-Table Selection

A selection in the main editor covers a rendered table as a single block; it cannot address anything inside one,
because rows and columns are the multi-cell selection's job.

- `tableRuntime/selection/tableSelectionSnap.ts` filters selection-only transactions, growing any range that reaches
  a table until it contains the whole table. Contact is enough — an endpoint resting on a table edge has been dragged
  onto the widget, because the positions either side of a table belong to its separating blank lines. Carets,
  document changes, raw mode, and any state where a cell editor or cell selection owns the table are left alone.
- `tableWidget/tableSelectionHighlight.ts` marks the widget roots the selection covers end to end and paints them as
  one selected block. CodeMirror's selection background sits behind editor text, which a rendered table's own opaque
  surfaces — the header, inline code, `==highlight==`, images — would stand proud of, so the highlight is layered
  instead: the selection colour on the widget root for the padding and the strip beside a narrow table, and over each
  cell the fill `tableWidget/selectionTint.ts` shares with the multi-cell selection — a known ground, plus an overlay
  compositing it up to the selection colour and taking the cell's content with it. The overlay hangs off the cells so
  it scrolls with a wide table; the cell borders are tinted through their colour, since an overlay grown to reach them
  would darken each shared one twice. A gridline where a selection ends mid-table is shared by cells that disagree
  about its colour, and CSS settles that in favour of the cell further up and left — leaving a rectangle's top and
  left edges drawn by their unselected neighbours — so the overlay redraws those two sides itself, in the same opaque
  tinted colour. Both fills read `--rt-tint` and `--rt-selection-bg`, resolved once in
  `tableWidget/richTableThemeVars.ts` so they can never disagree about focus. That resolution tests
  `:focus-within` rather than `.cm-focused`, which tracks only the root editor's own content: a
  nested cell editor holds focus on the plugin's behalf, most visibly through a cell drag.
- `tableWidget/selectionOverlayColor.ts` solves for that overlay: the faintest layer that reproduces the selection
  colour on the painted ground. Being faint and of the opposite tone to the text, it recolours every surface at the
  ground's tone exactly while leaving the text legible — where the selection colour at some chosen alpha would wash
  the text out and still not reach the opaque surfaces. The layer's colour and alpha are published separately so the
  same tint can also be laid over a base no overlay covers, such as a border colour. Untinted, a gridline all but
  vanishes: the divider colour is a light grey chosen to read on the editor background rather than on the darker
  selection ground.
- Painting the block ourselves also decouples the highlight from `drawSelection`, whose rects around a selected table
  are unreliable — it measures through `coordsAtPos`, which `TableWidget.coordsAt` answers with cell rectangles. The
  browser's native `::selection` is suppressed inside a widget for the same reason: `drawSelection` only neutralizes
  it for text inside `.cm-line`.

## Mouse Interaction

- Clicking a cell activates it or updates the current multi-cell selection.
- Dragging from one cell to another with a desktop mouse creates a rectangular selection. A movement threshold keeps
  ordinary clicks distinct from drags. Touch and pen pointers retain native scrolling/tap behaviour and do not start
  drag selection. Holding a cell drag near an edge auto-scrolls the table horizontally and whichever element owns
  vertical scrolling vertically — see [Table-Display.md](./Table-Display.md#host-scroll-modes).
  Releasing a drag back over its anchor opens that cell's editor. A completed rectangular selection focuses the main
  editor on release so its keyboard and clipboard commands work even when focus started outside the editor.
- Once a gesture becomes a rectangular selection it records itself in `cellDragField` until release. See
  [Table-Runtime-Invariants.md](./Table-Runtime-Invariants.md#cell-drag-ownership) for what that ownership means; the
  gesture settles the deferred state on release, clearing the active cell unless the drag contracts back to its anchor.
- A drag that starts anywhere in the active cell—including row-height padding outside the nested editor—keeps the
  nested editor open while it stays in that cell. Drags beginning on editable content retain native text selection. When
  the pointer travels a short margin past the cell's border into another cell, ownership switches to rectangular cell
  selection with the active cell as its anchor; the margin keeps a graze past the border from converting the gesture.
  Conversion ends the nested editor's native text drag by dispatching one mouse move with no button held, which is
  how CodeMirror tears down its own drag and the interval driving its edge scrolling; nothing is suppressed for the
  rest of the gesture.
- Shift+Arrow reopens the anchor editor when it contracts a multi-cell selection back to that one cell.
- Links delegate to the content-script link opener and then to the main plugin.
- Heading and footnote anchors scroll the main editor through `scrollToAnchor`.

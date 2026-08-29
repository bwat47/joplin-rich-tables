# Interaction and Navigation

## Keyboard Navigation

Cells are separate editor instances (or `<td>` when inactive). Key events are intercepted to simulate natural navigation.

| Key                 | Action        | At the cell boundary                                                        |
| :------------------ | :------------ | :-------------------------------------------------------------------------- |
| **Tab**             | Next cell     | Last cell creates a new row.                                                |
| **Shift+Tab**       | Previous cell | First cell is blocked.                                                      |
| **Enter**           | Cell below    | Last row creates a new row.                                                 |
| **ArrowLeft/Right** | Move by char  | Cell edge moves to the previous/next cell; grid edge exits the table.       |
| **ArrowUp/Down**    | Move by line  | Visual top/bottom moves to the cell above/below; grid edge exits the table. |

### Crossing the Table Boundary

A rendered table is a block replace decoration, so the main editor's caret is only ever adjacent to a table, never
usefully inside one. Entry and exit are the two halves of that crossing, and the opposite key reverses it.

**Entry** (`tableRuntime/navigation/mainEditorTableEntry.ts`): deletion and plain arrow movement toward a table open a
cell instead of moving the caret into the replaced range. Extra blank lines in between stay ordinary editable text.

| Caret is        | Key                           | Opens                                                            |
| :-------------- | :---------------------------- | :--------------------------------------------------------------- |
| Above the table | Delete, ArrowRight, ArrowDown | First header cell, caret at its start                            |
| Below the table | Backspace, ArrowLeft          | Final cell, caret at its end                                     |
| Below the table | ArrowUp                       | First cell of the final row, caret at the start of its last line |

**Exit** (`tableRuntime/navigation/tableExit.ts`): a nested-editor arrow key that walks off the grid clears the active
cell, moves the caret to the adjacent line, closes the nested editor through the normal lifecycle, and returns focus to
the main editor. ArrowUp from the header's visual top and ArrowLeft from the first cell's start exit above; ArrowDown
from the final row's visual bottom and ArrowRight from the final cell's end exit below. A table against a document edge
has no adjacent line, so the key is swallowed instead.

Rules that hold across both halves:

- Deletion protection keys off CodeMirror's semantic `delete.backward`/`delete.forward` transactions rather than
  physical key bindings, so word- and line-wise deletes are covered while IME and soft-keyboard `input.type` stays under
  CodeMirror's platform behavior.
- A cell editor holds one caret, so only one may enter: a multi-cursor deletion enters the first table in document order
  and drops the rest. Once entry is requested, key repeat is suppressed until the nested editor takes focus, so a held
  key cannot walk the main caret through the hidden Markdown.
- For a ragged table the target is the edge cell that has a source range; the entry transaction squares the table and
  remaps that cell in one step.
- The blank line a table needs on each side counts as part of its boundary. A deletion toward the table enters its edge
  cell, while a deletion away from it is trimmed to spare the separator - becoming a one-position caret move when the
  separator was all it covered; neither consumes the required separation. A newline sitting directly against a table
  edge is protected the same way even when surplus blank lines remain, since removing it would leave the caret parked
  on the widget edge. Surplus blank lines further out are ordinary text and still delete one press at a time.
- Arrow entry requires a lone empty caret in rendered mode with no live cell selection — anything else stays with the
  main editor. Vertical entry also has to recover the table a movement _skipped_, since CodeMirror scans past block
  widgets; see `resolveSkippedTableBlock`.

### Cell Selection Caret

- The caret is parked at the focus cell's document position so clipboard and shortcut handling keep working, and the
  main editor's caret is hidden so the highlight alone conveys the state.
- An unmodified arrow key collapses the selection and moves the caret out of the table, the way an arrow key collapses
  a text selection; Shift+Arrow extends it instead.
- Any other command that moves the caret outside the selected table drops the selection.

### Scrolling

Primary cell navigation opens the target nested editor, then focuses its `contentDOM`. The browser scrolls that focused
cell into view as needed, which works more reliably on mobile than explicitly calling `scrollIntoView`.

The plugin still uses explicit `scrollIntoView` for other paths such as anchor jumps and source/raw-mode cursor
visibility.

### Open-Cell Request State

Rapid navigation races a new request against the previously requested cell mounting, so open-cell transitions are
tracked in a `StateField` (`tableRuntime/openCellRequest.ts`) rather than a module-global lock.

- The initiating action dispatches a request carrying target cell, cursor placement, and key-suppression state, plus
  any canonical-form repair the table needed; the lifecycle trigger carries only the request id. Requests built from
  bare coordinates (a structural mutation naming a table it is about to write) cannot be repaired this way, so they use
  a separate builder returning selection and effects only, which the caller merges into its own transaction.
- Lifecycle re-reads the pending request, then completes it once the nested editor is open and focus has been handed
  off, or fails it when the open path aborts. A watchdog `ViewPlugin` fails stuck requests after 1 second.
- Row creation uses the same path: one transaction updates table text, main-editor selection, active-cell state, and
  open intent together, and Tab/Enter suppression reads the pending request.

## Selection Sync

Two active selections exist: hidden main editor selection and visible nested editor selection.

- **Nested → Main**: Selection in cell maps to corresponding main document range. Enables Joplin toolbar (Bold, Italic, Link) to work.
- **Android focus guard**: Reclaims focus when toolbar actions steal it.

## Multi-Cell Selection Shortcuts

When multi-cell selection mode is active, keyboard handling is routed through the table widget rather than a nested editor.

- **Shift+Arrow**: Start or extend a rectangular selection.
- **Enter/Tab**: Activate the focused cell and reopen the nested editor.
- **Escape**: Clear the multi-cell selection.
- **Delete/Backspace**: Remove the selected range. Non-empty cells are cleared; fully-selected empty rows/columns are structurally deleted instead.
- **Ctrl + C**: Copy selected cells to clipboard.
- **Ctrl + X**: Clear selected cells and copy them to clipboard. If selection only contains entirely empty rows/columns, delete the rows/columns instead of clearing cell content.
- **Ctrl + V**: Paste selected cells into table, expanding as needed.
- **Undo/Redo**: `Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z`, and `Ctrl+Y` are forwarded to the main editor history while selection mode is active.

## Mouse Interaction

- **Links**: `[text](url)` routes through the content-script link opener, which delegates the actual open action to the main plugin side.
- **Anchors/Footnotes**: `#heading` scrolls main editor via `scrollToAnchor`.

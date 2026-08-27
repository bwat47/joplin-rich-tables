# Interaction and Navigation

## Keyboard Navigation

Cells are separate editor instances (or `<td>` when inactive). Key events are intercepted to simulate natural navigation.

| Key                 | Action        | Behavior                                                  |
| :------------------ | :------------ | :-------------------------------------------------------- |
| **Tab**             | Next Cell     | End of row/column creates new row.                        |
| **Shift+Tab**       | Previous Cell |                                                           |
| **Enter**           | Cell Below    | Last row creates new row.                                 |
| **ArrowLeft/Right** | Navigate Cell | At boundary, jumps to prev/next cell.                     |
| **ArrowUp/Down**    | Navigate Line | At visual top/bottom boundary, jumps to cell above/below. |

From the main editor, hardware Backspace or Delete stops before it can remove the final line break adjoining a rendered
table or any of the table's hidden Markdown. Instead, it opens the boundary cell: Backspace enters the final cell at its
end, while Delete enters the first cell at its start. Extra blank lines between the caret and table remain ordinary editable text.
For a ragged table, the target is the edge cell that has a source range; normalization makes the table rectangular after
that resolvable cell has been activated.
Protection follows CodeMirror's semantic `delete.backward` and `delete.forward` transactions rather than physical key
bindings, and covers every caret of a multi-cursor deletion: the first table reached in document order is entered and
the rest of the gesture is dropped, since a cell editor holds a single caret. Soft-keyboard and IME `input.type` transactions remain under CodeMirror's platform behavior. Further deletions into that
table, arriving before the requested cell opens, are dropped since the caret is parked inside it until then.

While a cell selection is live the caret is parked at the focus cell's document position so clipboard and shortcut
handling keep working, and the main editor's caret is hidden so the highlight alone conveys the state. An unmodified
arrow key collapses the selection and moves the caret out of the table, the way an arrow key collapses a text selection;
Shift+Arrow extends it instead. Any other command that moves the caret outside the selected table drops the selection.

Plain arrow keys from the main editor detect entry into a rendered table from CodeMirror's visual movement target.
ArrowRight from the adjoining line above opens the first cell at its start; ArrowLeft from the adjoining line below
opens the final cell at its end. Horizontal direction follows CodeMirror's text direction for the current line.
ArrowDown/ArrowUp also account for a target that overshoots the widget, locating the table from the block the movement
stepped over. CodeMirror's vertical motion deliberately scans past block widgets, so a movement toward a table usually
lands on the far side of it; the block adjacent to the caret's own line block is then the one that was skipped, and a
replaced block there identifies the table. Entry from above opens the top-left header cell at its start; entry from below
opens the first cell of the final row at the start of its last line. Other vertical movement remains owned by the main
editor.

Inside a nested editor, plain ArrowUp from the header's visual top boundary and ArrowLeft from the first cell's start
exit to the blank line above the table. Plain ArrowDown from the final row's visual bottom boundary and ArrowRight from
the final cell's end exit to the blank line below it. The active cell is cleared, the nested editor closes through the
normal lifecycle, and focus returns to the main editor.

### Scrolling

Primary cell navigation opens the target nested editor, then focuses its `contentDOM`. The browser scrolls that focused
cell into view as needed, which works more reliably on mobile than explicitly calling `scrollIntoView`.

The plugin still uses explicit `scrollIntoView` for other paths such as anchor jumps and source/raw-mode cursor
visibility.

### Open-Cell Request State

Rapid navigation can cause race conditions (new request before previous cell mounts).

Open-cell transitions are tracked by a CodeMirror `StateField` in `tableRuntime/openCellRequest.ts`.
Keyboard navigation dispatches an explicit request with target cell, cursor placement, normalization intent, and
key-suppression state. The lifecycle trigger carries only the request id; lifecycle re-reads the pending request,
then completes it after the nested editor opens and focus has been handed off, or fails it when the open path aborts.
A watchdog ViewPlugin fails stuck requests after 1 second.

Row creation uses the same explicit reopen path as other command-driven structural operations.
The row-insert transaction updates table text, main-editor selection, active-cell state, and open intent together.
Lifecycle then reopens the replacement nested editor, and Tab/Enter suppression reads the pending request state rather
than a module-global lock.

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

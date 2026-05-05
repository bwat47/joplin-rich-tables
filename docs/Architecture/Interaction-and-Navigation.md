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

### Scrolling

Primary cell navigation opens the target nested editor, then focuses its `contentDOM`. The browser scrolls that focused
cell into view as needed, which works more reliably on mobile than explicitely calling `scrollIntoView`.

The plugin still uses explicit `scrollIntoView` for other paths such as anchor jumps, source/raw-mode cursor
visibility, and multi-cell selection focus.

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

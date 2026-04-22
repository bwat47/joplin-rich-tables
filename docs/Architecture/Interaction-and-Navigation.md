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

`scrollIntoView` is called automatically when target cell is outside viewport.

### Navigation Lock

Rapid navigation can cause race conditions (new request before previous cell mounts).

The `tableRuntime/navigationLock.ts` module:

1. `acquireNavigationLock()` before navigating; rejects if locked.
2. Lock held while state dispatches, nested editor mounts, focus transfers.
3. `releaseNavigationLock()` called via `onFocused` callback.
4. Auto-releases after 1 second to prevent deadlock.

Row creation now uses a two-phase reopen flow on top of the shared row-insert transaction:
the row-insert operation dispatches table replacement, main-editor selection, active-cell state,
and an open request in one transaction, then immediately hands focus to the main editor without
scrolling so mobile IMEs stay alive through the close/reopen gap. Lifecycle still owns the second
phase: reopening the replacement nested editor and invoking `onFocused` after that editor takes focus.

This pass only aims to match current toolbar behavior on mobile. It does not add a dedicated
row-insert scroll policy beyond the existing selection update plus focus handoff.

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

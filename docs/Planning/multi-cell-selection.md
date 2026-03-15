# Multi-Cell Selection with Cut/Copy/Paste

## Context

The plugin currently supports only single-cell interaction — click a cell, edit it. Users cannot select a rectangular range of cells to copy/cut/paste content. This feature would bring spreadsheet-like selection to the table widget, with clipboard support using markdown table fragments.

The plugin's architecture is centered around a single active cell with a nested CodeMirror editor. Multi-cell selection is a **separate, parallel concept** — it does not require multiple nested editors. Selection and editing are mutually exclusive modes.

## Phased Scope

### Phase 1: Selection + Copy (this plan) - COMPLETED

- Rectangular cell selection via Shift+Arrow and Shift+Click
- Visual highlighting of selected cells
- Ctrl+C copies selected cells as a markdown table fragment
- Escape clears selection

### Phase 2: Anchor-Based Cut + Expanding Paste - COMPLETED

- Ctrl+X copies the selected rectangle as a markdown table fragment, then clears those cells
- Ctrl+V uses the selection's top-left cell as the anchor when a selection exists
- Ctrl+V also works from an active nested editor; a valid pasted markdown table closes the nested editor and uses the active cell as the anchor
- Pasted table fragments can expand downward and to the right by adding body rows and columns
- Successful cut/paste leaves the affected rectangle selected
- Invalid markdown-table paste is ignored in selection mode and falls through to normal nested-editor paste behavior when editing a single cell

Implementation note: in Joplin, Cmd/Ctrl+V from a nested editor can arrive as a root-editor `input.paste`
transaction rather than a nested-editor DOM paste event. The shipped implementation handles that in
`nestedEditor/mainEditorGuard.ts` by upgrading valid markdown table fragments before cell sanitation.

---

## Phase 1 Implementation Plan

### State Machine

Three mutually exclusive modes:

```
idle ──click──> editing ──Shift+Arrow──> selecting
  ^                |                        |
  |   Esc/click    |      Esc/click outside |
  +────────────────+────────────────────────+
                   ^      Enter/click cell  |
                   +────────────────────────+
```

- **idle**: No active cell, no selection
- **editing**: Active cell with nested editor open (existing behavior)
- **selecting**: Cell selection active, no nested editor, active cell cleared

Transitions:

- `editing → selecting`: Shift+Arrow at cell boundary closes nested editor, sets selection
- `selecting → editing`: Click cell (without Shift) or Enter clears selection, activates cell
- `selecting → idle`: Escape or click outside table
- Any mode where selection exists + normal click = clear selection first

### New Files

#### 1. `src/contentScript/tableWidget/cellSelectionState.ts`

Core state field modeled after `activeCellState.ts`.

```typescript
interface CellSelection {
    tableFrom: number; // Position-mapped across doc changes
    anchor: CellCoords; // Where selection started
    focus: CellCoords; // Current extent
}

interface SelectionRect {
    minRow: number; // Unified row (header=0, body=1+)
    maxRow: number;
    minCol: number;
    maxCol: number;
}
```

Exports:

- `setCellSelectionEffect`, `clearCellSelectionEffect` — StateEffects
- `cellSelectionField` — StateField, clears itself when `setActiveCellEffect` fires (editing clears selection)
- `getCellSelection(state)` — accessor
- `toSelectionRect(sel)` — normalizes anchor/focus to min/max rectangle
- `isCellInRect(rect, coords)` — pure hit-test (rectangular, not sequential)
- `toUnifiedRow(coords)` / `fromUnifiedRow(row)` — coordinate helpers

Clear on `docChanged` (conservative — avoids stale coordinates after undo/redo).

#### 2. `src/contentScript/tableWidget/cellSelectionVisuals.ts`

ViewPlugin that applies/removes CSS class on cell DOM elements when selection changes.

- Reads `cellSelectionField` from state on each `update()`
- Compares with previous rect; if changed, queries `td[data-section][data-row][data-col]` and toggles `CLASS_CELL_SELECTED`
- ViewPlugin is correct here (not StateField) because this is ephemeral DOM styling, not layout-affecting decoration

#### 3. `src/contentScript/tableWidget/cellSelectionKeymap.ts`

Selection keyboard handling via a single document-level capture plugin. A CM keymap was not added: once selection mode is active, the nested editor is closed and focus leaves CodeMirror, so a keymap would never fire. The capture plugin intercepts events before CM's handlers and calls `preventDefault` + `stopPropagation` when it handles them.

`extendOrStartSelection(direction)`:

1. If `cellSelectionField` has value → move `focus` in direction (clamped to table bounds)
2. If `activeCellField` has value but no selection → use active cell as anchor, compute focus = anchor + direction, dispatch `setCellSelectionEffect` + `clearActiveCellEffect`
3. If neither → return `false`

Capture plugin:

- Handles `Shift+Arrow`, `Escape`, and `Enter` while a cell selection exists
- Scoped via `canHandleTableSelectionShortcut` so it does not steal shortcuts from toolbar buttons or other interactive controls

#### 4. `src/contentScript/tableWidget/cellSelectionClipboard.ts`

Copy handling via document-level capture plugin:

```typescript
ViewPlugin.fromClass(
    class {
        constructor(view) {
            view.dom.ownerDocument.addEventListener('copy', onCopy, true);
        }
    }
);
```

- `extractSelectedCellContents(state, sel)` → `string[][]`: reads cell text from doc using `computeMarkdownTableCellRanges()` + `getCellRange()`
- `copySelectionAsMarkdown(state, sel)` → string: builds a valid markdown table fragment from selected cells using `MarkdownTable.fromParts()` + `serialize()`. Includes alignment row when header cells are in the selection.
- Capture plugin is needed because selection mode does not reliably keep CodeMirror focused.
- Final implementation detail: this module also owns the shared table-paste rewrite helpers used by both document-level clipboard capture and the main-editor paste guard.

### Modified Files

#### 5. `domHelpers.ts`

Add constant:

```typescript
export const CLASS_CELL_SELECTED = 'cm-table-cell-selected';
```

#### 6. `tableStyles.ts`

Add CSS rule after the active cell styles (~line 109):

```typescript
[`.${CLASS_TABLE_WIDGET_TABLE} td.${CLASS_CELL_SELECTED},
  .${CLASS_TABLE_WIDGET_TABLE} th.${CLASS_CELL_SELECTED}`]: {
    backgroundColor: 'var(--joplin-selected-text-background-color, rgba(0, 120, 215, 0.15))',
},
```

#### 7. `tableWidgetInteractions.ts`

Modify mousedown handler:

- If `event.shiftKey` and active cell or selection exists → dispatch `setCellSelectionEffect` extending to clicked cell (+ `clearActiveCellEffect` if transitioning from editing)
- If no shift and selection exists → dispatch `clearCellSelectionEffect` before normal cell activation

#### 8. `domHandlers.ts` (nested editor)

Add Shift+Arrow bindings to nested editor keymap. At cell content boundaries only (same boundary detection as existing Arrow keys):

- Close nested editor
- Dispatch selection with anchor = current cell, focus = adjacent cell
- Must use the `cellSelectionTransitionAnnotation` (see below)

Final implementation detail:

- Nested-editor multi-cell paste is not driven by a nested-editor DOM `paste` handler.
- `domHandlers.ts` keeps a CodeMirror clipboard/input fallback (`clipboardInputFilter` + `inputHandler`) for cases where paste text enters through the nested editor's input pipeline.

#### 8b. `mainEditorGuard.ts` (nested editor)

Add a root-editor paste upgrade path while the nested editor is open:

- Detect root-editor `input.paste` transactions targeting the active cell
- If the inserted text parses as a markdown table fragment, convert the transaction into the same multi-cell table rewrite used by clipboard capture
- Fall back to the existing sanitize/reject logic when the pasted text is not a valid table fragment

#### 9. `tableWidgetExtension.ts`

Register new extensions in the array:

```
activeCellField,
cellSelectionField,              // NEW - after activeCellField
...
cellSelectionKeymap,             // NEW - before navigationLockKeymap
...
cellSelectionKeyCapturePlugin,   // NEW
cellSelectionClipboardPlugin,    // NEW
cellSelectionVisualsPlugin,      // NEW
```

#### 10. `nestedEditorLifecycle.ts`

When `clearActiveCellEffect` fires during a selection transition, the lifecycle plugin should not schedule cursor-management side effects (like `scheduleEnsureCursorVisible`). Add a `cellSelectionTransitionAnnotation` check to gate these actions.

### Test Files

#### `cellSelectionState.test.ts`

- `toSelectionRect()` — various anchor/focus combos, header+body spans
- `isCellInRect()` — inside, outside, boundary cases
- `toUnifiedRow()` / `fromUnifiedRow()` — round-trips, header vs body
- StateField behavior: set, clear, clear-on-setActiveCell, clear-on-docChanged

#### `cellSelectionClipboard.test.ts`

- `extractSelectedCellContents()` — header-only, body-only, cross-boundary
- Edge cases: cells with escaped pipes, `<br>` tags, empty cells

---

## Key Design Decisions

1. **Selection is rectangular, not sequential** — selecting from (0,1) to (2,3) selects ALL cells in that rectangle, not a range of cells in reading order.

2. **Selection normally clears on docChanged, except explicit clipboard rewrites** — arbitrary doc changes still clear selection conservatively, but cut/paste transactions re-set the resulting rectangle in the same dispatch so the affected area stays visible.

3. **Markdown table clipboard format** — copied cells produce a valid markdown table fragment. Multi-cell paste only triggers when `MarkdownTable.parse()` accepts clipboard `text/plain`. Alignment row included when header is in selection.

4. **ViewPlugin for visuals, not decoration rebuild** — toggling CSS classes is cheaper than forcing widget reconstruction. The plugin reads state and mutates DOM directly.

5. **Active cell cleared during selection** — this avoids ambiguity about which systems are active and prevents the toolbar/guard/lifecycle from interfering.

---

## Risks

| Risk                                                       | Mitigation                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Widget rebuild clears CSS classes mid-selection            | ViewPlugin re-applies classes in `update()` after any transaction                                      |
| Lifecycle plugin side effects on clearActiveCell           | `cellSelectionTransitionAnnotation` gates cursor management                                            |
| Shift+Arrow in nested editor conflicts with text selection | Only intercept at content boundaries (same pattern as existing Arrow keys)                             |
| Selection across header/body boundary edge cases           | Unified row coordinate system handles this naturally                                                   |
| Selection mode has unreliable editor focus                 | Use document-level capture plugins for copy and repeated keyboard navigation                           |
| Joplin may route nested-editor Cmd/Ctrl+V through root `input.paste` | `mainEditorGuard.ts` upgrades valid markdown-table fragments before the single-cell sanitation path runs |

## Verification

1. `npm test` — all new unit tests pass, existing tests unbroken
2. `npm run dist` — builds successfully
3. Manual testing in Joplin:
    - Click cell → Shift+Arrow in all directions → verify highlight
    - Continue pressing Shift+Arrow repeatedly → verify focus is not required for extension
    - Shift+Click distant cell → verify rectangular highlight
    - Ctrl+C → paste in text editor → verify valid markdown table output
    - With toolbar or unrelated UI control focused, verify Ctrl+C / Ctrl+X / Ctrl+V / Escape / Enter do not get stolen unexpectedly
    - Escape → verify selection clears
    - Click cell (no Shift) during selection → verify selection clears, cell activates
    - Widget rebuild (edit elsewhere in doc) during selection → verify highlight persists
    - Undo during selection → verify selection clears cleanly
    - Paste a copied range into a smaller selection → verify top-left anchoring, not selection-size matching
    - Paste a copied range from an active nested editor → verify editor closes and pasted rectangle becomes selected
    - Paste a fragment that exceeds table bounds → verify rows/columns are added and only new columns inherit clipboard alignments
    - Paste plain text while nested editor is active → verify normal single-cell paste still works

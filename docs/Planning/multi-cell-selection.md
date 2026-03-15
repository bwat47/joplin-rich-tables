# Multi-Cell Selection with Cut/Copy/Paste

## Context

The plugin currently supports only single-cell interaction — click a cell, edit it. Users cannot select a rectangular range of cells to copy/cut/paste content. This feature would bring spreadsheet-like selection to the table widget, with clipboard support using markdown table fragments.

The plugin's architecture is centered around a single active cell with a nested CodeMirror editor. Multi-cell selection is a **separate, parallel concept** — it does not require multiple nested editors. Selection and editing are mutually exclusive modes.

## Phased Scope

### Phase 1: Selection + Copy (this plan)
- Rectangular cell selection via Shift+Arrow and Shift+Click
- Visual highlighting of selected cells
- Ctrl+C copies selected cells as a markdown table fragment
- Escape clears selection

### Phase 2: Cut + Paste (follow-up)
- Ctrl+X = copy + clear selected cell contents
- Ctrl+V into a same-sized selection replaces cell contents
- Requires new `MarkdownTable` mutation methods

### Phase 3: Expanding Paste (deferred)
- Paste that adds rows/columns when clipboard content exceeds selection bounds

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
    tableFrom: number;       // Position-mapped across doc changes
    anchor: CellCoords;      // Where selection started
    focus: CellCoords;       // Current extent
}

interface SelectionRect {
    minRow: number;          // Unified row (header=0, body=1+)
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

Selection keyboard handling.

Use two layers:
- Standard CM keymap for cases where the main editor still has focus
- Document-level capture plugin for selection mode, because there is no nested editor and the main editor focus is not reliable after the initial transition

Main editor keymap:

```typescript
keymap.of([
    { key: 'Shift-ArrowRight', run: extendOrStartSelection('right') },
    { key: 'Shift-ArrowLeft',  run: extendOrStartSelection('left') },
    { key: 'Shift-ArrowUp',    run: extendOrStartSelection('up') },
    { key: 'Shift-ArrowDown',  run: extendOrStartSelection('down') },
    { key: 'Escape',           run: clearSelectionIfActive },
])
```

`extendOrStartSelection(direction)`:
1. If `cellSelectionField` has value → move `focus` in direction (clamped to table bounds)
2. If `activeCellField` has value but no selection → use active cell as anchor, compute focus = anchor + direction, dispatch `setCellSelectionEffect` + `clearActiveCellEffect`
3. If neither → return `false`

Reuses direction math from `tableNavigation.ts` (unified row system, boundary clamping). Extract shared helpers if needed.

Document capture plugin:
- Handles repeated `Shift+Arrow`, `Escape`, and `Enter` while a cell selection exists
- Must be scoped carefully so it does not steal shortcuts from unrelated UI controls or toolbar buttons

#### 4. `src/contentScript/tableWidget/cellSelectionClipboard.ts`

Copy handling via document-level capture plugin:

```typescript
ViewPlugin.fromClass(class {
    constructor(view) {
        view.dom.ownerDocument.addEventListener('copy', onCopy, true);
    }
})
```

- `extractSelectedCellContents(state, sel)` → `string[][]`: reads cell text from doc using `computeMarkdownTableCellRanges()` + `getCellRange()`
- `copySelectionAsMarkdown(state, sel)` → string: builds a valid markdown table fragment from selected cells using `MarkdownTable.fromParts()` + `serialize()`. Includes alignment row when header cells are in the selection.
- Capture plugin is needed because selection mode does not reliably keep CodeMirror focused

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

2. **Clear selection on docChanged** — conservative approach avoids stale coordinates after undo. The user can re-select easily. Can be refined later to map coordinates.

3. **Markdown table clipboard format** — copied cells produce a valid markdown table fragment. Pasting into Joplin (or any markdown editor) creates a new table naturally. Alignment row included when header is in selection.

4. **ViewPlugin for visuals, not decoration rebuild** — toggling CSS classes is cheaper than forcing widget reconstruction. The plugin reads state and mutates DOM directly.

5. **Active cell cleared during selection** — this avoids ambiguity about which systems are active and prevents the toolbar/guard/lifecycle from interfering.

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Widget rebuild clears CSS classes mid-selection | ViewPlugin re-applies classes in `update()` after any transaction |
| Lifecycle plugin side effects on clearActiveCell | `cellSelectionTransitionAnnotation` gates cursor management |
| Shift+Arrow in nested editor conflicts with text selection | Only intercept at content boundaries (same pattern as existing Arrow keys) |
| Selection across header/body boundary edge cases | Unified row coordinate system handles this naturally |
| Selection mode has unreliable editor focus | Use document-level capture plugins for copy and repeated keyboard navigation |
| Document-level capture can hijack unrelated shortcuts | Scope handlers narrowly and verify behavior with toolbar/buttons focused before expanding to cut/paste |

## Verification

1. `npm test` — all new unit tests pass, existing tests unbroken
2. `npm run dist` — builds successfully
3. Manual testing in Joplin:
   - Click cell → Shift+Arrow in all directions → verify highlight
   - Continue pressing Shift+Arrow repeatedly → verify focus is not required for extension
   - Shift+Click distant cell → verify rectangular highlight
   - Ctrl+C → paste in text editor → verify valid markdown table output
   - With toolbar or unrelated UI control focused, verify Ctrl+C / Escape / Enter do not get stolen unexpectedly
   - Escape → verify selection clears
   - Click cell (no Shift) during selection → verify selection clears, cell activates
   - Widget rebuild (edit elsewhere in doc) during selection → verify highlight persists
   - Undo during selection → verify selection clears cleanly

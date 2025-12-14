# Refactoring Plans (Rich Tables)

This document outlines concrete refactor plans aimed at improving **separation of concerns** and **maintainability**.

Each refactor includes:

- Goal
- Why (problem it solves)
- Proposed shape (new modules / responsibilities)
- Step-by-step plan
- Acceptance criteria
- Risks / tradeoffs

---

## 1) Make `TableWidget` render-only (move interaction/controller code out) - DONE

### Goal

Make the table widget responsible only for rendering DOM, not for editor behavior (click handling, state dispatch, nested editor orchestration).

### Why

Right now `TableWidget` mixes:

- view rendering (DOM creation)
- interaction routing (link clicks vs cell clicks)
- table position resolution
- active-cell state updates
- opening the nested editor

That coupling makes future changes riskier (e.g., changing cell activation policy might unintentionally break rendering, and vice versa).

### Proposed shape

- `TableWidget`:
    - builds the DOM structure
    - tags cells with stable identifiers (section/row/col)
    - does NOT dispatch transactions
    - does NOT open nested editors
- New module (one of these):
    - `src/contentScript/tableInteractions.ts` (recommended)
    - OR fold into `tableWidgetExtension.ts` as a ViewPlugin

### Status (implemented)

- Controller lives in `src/contentScript/tableWidgetInteractions.ts` and is wired via `EditorView.domEventHandlers({ mousedown })` in `src/contentScript/tableWidgetExtension.ts`.
- `TableWidget` no longer handles link clicks / cell activation / nested editor orchestration.
- Minor exception: `TableWidget` still renders an “Edit table” button that dispatches selection to reveal raw markdown (kept intentionally small and self-contained).

### Notes / gotchas encountered

- `TableWidget.ignoreEvent()` must return `false` so the extension-level DOM handlers receive widget events.
- Nested editor keydown events must not bubble to the main editor (otherwise Backspace/Delete can affect the outer selection).
- Undo/redo forwarded from the nested editor needed scroll preservation (`scrollSnapshot()` dispatched immediately and again on the next animation frame to avoid a one-frame jump).

### Plan

1. Define a single exported function (controller entrypoint), e.g.
    - `handleTableWidgetMouseDown(view: EditorView, event: MouseEvent): boolean`
2. Move the current widget `mousedown` logic into that function:
    - Link detection + `openLink`
    - Cell detection + computing cellFrom/cellTo
    - Dispatch `setActiveCellEffect`
    - Call `openNestedCellEditor`
3. Replace the widget’s `container.addEventListener('mousedown', ...)` with _minimal_ wiring:
    - either no listener at all, or a thin wrapper calling the controller
4. Prefer routing events via `EditorView.domEventHandlers({ mousedown })` at the extension layer:
    - If the click target is inside `.cm-table-widget`, call the controller.
    - Otherwise return false.
5. Keep `TableWidget.ignoreEvent()` aligned with the chosen architecture:
    - If using editor-level handler, consider returning `false` (or keep `true` if necessary) and ensure events still reach the handler.

### Acceptance criteria

- Clicking links still opens correctly.
- Clicking a cell still activates the nested editor.
- No behavior regressions in selection/cursor handling.
- `TableWidget` no longer imports nested editor or active cell state modules.

### Risks / tradeoffs

- Event propagation nuances with `Decoration.replace()` widgets.
- Need to ensure editor-level handlers see events when `ignoreEvent()` is involved.

---

## 2) Centralize table resolution + cell range utilities

**Status:** DONE

### Goal

Have one canonical place for:

- resolving “which table am I interacting with?”
- computing per-cell source ranges
- translating (section,row,col) → absolute doc range

### Why

There are multiple related concepts spread across files:

- syntax-tree resolution
- `computeMarkdownTableCellRanges(text)`
- mapping relative→absolute offsets

Duplication increases drift risk (especially with trimming rules, escaped pipe handling, and syntax-tree timeouts).

### Status (implemented)

- Table-positioning concerns are centralized in `src/contentScript/tablePositioning.ts`:
    - syntax-tree scanning (`findTableRanges`, 100ms timeout)
    - syntax-tree resolving (`resolveTableAtPos`, 250ms timeout)
    - DOM target → table resolution fallback policy (`resolveTableFromEventTarget`)
    - section/row/col → doc range mapping (`resolveCellDocRange`)
- Cell-range computation remains in `src/contentScript/markdownTableCellRanges.ts` and is consumed via a thin wrapper (`getTableCellRanges`).
- `parseMarkdownTable()` moved into `src/contentScript/markdownTableParsing.ts` so `tableWidgetExtension.ts` no longer imports parsing from `TableWidget.ts`.
- Callsites updated:
    - `tableWidgetExtension.ts` uses `findTableRanges`.
    - `tableWidgetInteractions.ts` uses `resolveTableFromEventTarget` / `resolveCellDocRange`.

### Plan

1. Move (or wrap) syntax-tree lookup from `TableWidget` into the new module.
2. Re-export or relocate `computeMarkdownTableCellRanges` and related types (`TableCellRanges`, `CellRange`) into the module.
3. Update callsites:
    - table decoration building uses the new helpers
    - interaction/controller uses the new helpers
4. Standardize the syntax-tree timeout constant in this module.

### Acceptance criteria

- Only one implementation exists for resolving the current table node.
- Only one implementation exists for mapping section/row/col → cellFrom/cellTo.
- No behavior change in trimming, escaped-pipe handling, or range mapping.

### Risks / tradeoffs

- Requires carefully preserving existing trimming/range semantics.

---

## 3) Split `NestedCellEditorManager` responsibilities - DONE

### Goal

Reduce cognitive load by splitting nested editor code into smaller, single-purpose pieces.

### Why

`nestedCellEditor.ts` currently handles:

- DOM mounting (cell wrapper/host)
- sync plumbing (main↔subview)
- transaction policy (reject newlines/out-of-range, escape pipes, clamp selection)
- input routing (undo/redo forwarding, shortcut suppression)

Those are separable concerns with different change frequency.

### Status (implemented)

- Refactored `NestedCellEditorManager` into `transactionPolicy.ts`, `domHandlers.ts`, and `mounting.ts` in `src/contentScript/nestedEditor/`.
- `NestedCellEditorManager` now acts as a coordinator, delegating specific logic to these modules.
- Verification passed: Linting, Formatting, and Build checks successful.

### Proposed shape

Keep `NestedCellEditorManager` as orchestrator, but extract:

- `src/contentScript/nestedEditor/transactionPolicy.ts`
    - exports: `createCellTransactionFilter(rangeField)` and `createHistoryExtender()`
- `src/contentScript/nestedEditor/domHandlers.ts`
    - exports: `createNestedEditorDomHandlers(mainView)`
- `src/contentScript/nestedEditor/mounting.ts`
    - exports: `ensureCellWrapper(cell)` and “show/hide content vs editor host” helpers

(If you prefer fewer files, start by extracting only `transactionPolicy.ts`.)

### Plan

1. Extract the transaction filter as a pure factory that takes:
    - `rangeField`
    - possibly injected helpers (`escapeUnescapedPipes`, `clamp`)
2. Extract keydown/contextmenu handlers into a function that returns `EditorView.domEventHandlers({...})`.
3. Keep the manager responsible for:
    - creating the subview with the extensions
    - forwarding changes
    - applying main transactions
    - open/close lifecycle
4. Ensure exports remain stable (`openNestedCellEditor`, `closeNestedCellEditor`, `applyMainTransactionsToNestedEditor`).

### Acceptance criteria

- No behavior change:
    - selection clamping works
    - newline rejection works
    - pipe escaping works
    - undo/redo forwarding works
- File becomes easier to navigate (smaller modules, clearer boundaries).

### Risks / tradeoffs

- Refactor cost: moving code can introduce subtle ordering issues in CM extensions.

---

## 4) Add targeted unit tests for pure logic (cell ranges + pipe escaping)

### Goal

Lock in correctness for the most fragile logic so future refactors are safer.

### Why

The trickiest bugs so far are “off by N characters” range mapping issues. Those are easiest to prevent with small, precise tests.

### Proposed shape

- Add tests under `src/contentScript/__tests__/` or similar.
- Focus on pure functions only:
    - `computeMarkdownTableCellRanges`
    - `escapeUnescapedPipes` (could be exported for testing, or tested via a small wrapper)

### Plan

1. Confirm test framework setup (Jest vs other). If none exists, add the minimal setup recommended by the existing project tooling.
2. Create a test file, e.g. `src/contentScript/tableRanges.test.ts`.
3. Add coverage for:
    - basic header/body range mapping
    - whitespace trimming inside cells
    - leading/trailing pipes
    - escaped pipes (`\|`) are not treated as delimiters
    - empty cells and uneven row lengths
4. Add a couple tests for the pipe escaping behavior:
    - `a|b` becomes `a\|b`
    - `a\|b` remains unchanged

### Acceptance criteria

- Tests pass reliably.
- Tests fail if trimming/delimiter behavior changes accidentally.

### Risks / tradeoffs

- Adding a test runner introduces some project maintenance overhead.

---

## 5) (Lower priority) Put renderer cache behind a tiny interface

### Goal

Make rendering/caching policy easy to evolve without touching widget/editor code.

### Why

Both `TableWidget` and `nestedCellEditor` depend directly on caching details (`getCached`, `renderMarkdownAsync`). This is fine today, but if you later want:

- cache invalidation per-note
- size limits
- different caching keys

…you’ll need to touch multiple callsites.

### Proposed shape

- Add a small exported object or interface:
    - `MarkdownRenderService` with methods: `renderAsync(text, cb)`, `getCached(text)`, `clear()`
- Keep `markdownRenderer.ts` as the implementation.

### Plan

1. Define and export a `renderer` object from `markdownRenderer.ts`.
2. Update callsites to use `renderer.getCached(...)` / `renderer.renderAsync(...)`.
3. Keep old named exports temporarily (optional) and remove later.

### Acceptance criteria

- No behavior change.
- Call sites depend on one abstraction, not the internal maps.

### Risks / tradeoffs

- Low risk, but also relatively low immediate value.

---

## 6) (Lower priority) Standardize syntax-tree timeouts + parsing “policy” constants

### Goal

Avoid “magic numbers” for syntax tree timeouts and keep parsing assumptions explicit.

### Why

`ensureSyntaxTree(..., timeout)` is used as a performance/behavior knob. Centralizing it makes tuning easier and prevents inconsistencies.

### Proposed shape

- Add constants in `tablePositioning.ts` (if you do refactor #2), e.g.
    - `const SYNTAX_TREE_TIMEOUT_MS = 250;`

### Plan

1. Introduce a constant.
2. Replace scattered values.
3. (Optional) add one comment explaining why the timeout is chosen.

### Acceptance criteria

- No behavior changes.
- All timeouts are defined once.

### Risks / tradeoffs

- None meaningful.

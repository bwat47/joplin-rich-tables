# Table Display

## Rendering

### Detection

Lezer syntax tree scanner detects Markdown tables → replaced with `Decoration.replace({ widget, block: true })` via StateField.

### Widget Structure

- `posAtDOM()` locates table widgets.
- Wide tables scroll horizontally within container.
- Each cell renders into a dedicated content wrapper (`CLASS_CELL_CONTENT`) so styling can be applied consistently between initial render and nested-editor activation.

### Media and Embed Constraints

Rendered cell HTML can include images, videos, and Joplin-rendered YouTube embeds.

- Media elements are constrained in `tableStyles.ts` to prevent them from expanding the table beyond the available width.
- Joplin resource icons / missing-resource placeholders have their size constrained via CSS.

## Optimizations

### 1. Decoration Update Strategy

- **Structural Edits**: Rebuild all table decorations for simpler, more reliable widget lifecycle handling.
- **In-Cell Edits**: No rebuild; decorations mapped to preserve existing DOM.
- **Sync Transactions**: From nested editor explicitly skip rebuilds.

### 2. DOM Reuse (Exact Source Text)

Each rendered widget root is associated with the exact table source it was built from.

`eq()` compares source text and document position, so a table that neither changed nor moved is
skipped entirely during a rebuild. Position is part of the comparison because in-cell edits map
decorations rather than rebuilding them, leaving a widget's recorded position stale.

When `eq()` reports a difference, `updateDOM()` decides between reuse and rebuild:

- Source text matches → DOM reused (return `true`); position-only changes refresh `data-table-from`.
- Source text differs, or the element is unrecognised → CodeMirror destroys/recreates.

Comparison is against the text itself, not a hash: a hash match only makes identical content
probable, and a collision would silently reuse DOM showing stale rows.

Prevents flicker when rebuilding decorations for position sync, and keeps stateful embedded
content (videos, iframes) alive across rebuilds.

### 3. Table Context Cache

`buildTableContext()` maintains an **LRU cache** (50 entries) keyed by table source text.

Each cache entry stores:

- Parsed `MarkdownTable`.
- Computed `cellRanges`.

`tableWidgetExtension.ts` reuses this shared context when building or rebuilding widgets, instead of parsing table structure and cell ranges independently.

### 4. Height Estimation

Prevents scroll jumping via multi-layered approach:

**Heuristic** (`estimateTableHeight`): Estimates based on row count, text length, image presence.

**ResizeObserver**: After async render:

1. `view.requestMeasure()` notifies CodeMirror.
2. Updates **LRU height cache** (200 tables per index).

**Height Cache**: Two LRU indexes over the same measurements, one keyed by source text and one by
document position, so a height survives both in-table edits (position unchanged) and edits above the
table (text unchanged). Text is consulted first: a text hit is the table's own measurement, whereas a
position hit only reports whatever was last measured at that offset and goes stale when a table above
is deleted.

**`coordsAt()`**: Maps positions in replaced table source to rendered cell rectangles for
CodeMirror coordinate consumers, notably cursor-positioned tooltips. Keyboard cell navigation
scrolls through nested-editor focus and does not depend on it.

## Display Modes

### Source Mode

`Ctrl+Shift+/` or toolbar toggle. Disables decoration field, reveals raw Markdown. Auto-closes active nested editor.

See [ADR-004](../ADR/004-global-source-mode.md) for the rationale behind global source mode.

### Search Override

`Ctrl+F` forces raw Markdown mode so native search highlighting works on hidden table text.

## Host Scroll Modes

Joplin hosts the editor two ways, and internal and external scrolling are mutually exclusive:

- **Desktop** pins CodeMirror to a fixed-height container, so `scrollDOM` scrolls internally.
- **Mobile and web** leave the editor's height unconstrained, so `scrollDOM` grows to the whole document and the
  document root scrolls instead.

`shared/editorViewport.ts` resolves both cases without a mode flag. `resolveViewportBounds` intersects the scroller
rect with the window: a scroller that already sits inside the window survives unchanged, and one that spans the
document is clipped back to the window. The floating toolbar uses those bounds to decide visibility and placement;
cell-drag auto-scroll uses them for its edge zones and for clamping its hit test.

The toolbar anchors to a box combining both elements the widget is made of, handed to Floating UI as a virtual
element. Horizontally it centres on the widget's `<table>` clipped to the widget root, so it tracks the visible slice
of a table that is wider than the editor. Vertically it uses the root, whose border box also covers the horizontal
scrollbar the root renders for such a table, at whatever width the host theme gives it.

Auto-scroll picks its scroll target from the same distinction, testing whether `scrollDOM` has any overflow to move
and falling back to `document.scrollingElement` when it does not.

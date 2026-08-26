# Table Display

## Rendering

### Detection

Lezer syntax tree scanner detects Markdown tables → replaced with `Decoration.replace({ widget, block: true })` via StateField.

### Widget Structure

- `posAtDOM()` locates table widgets.
- Wide tables scroll horizontally within container.
- Each cell renders into a dedicated content wrapper (`CLASS_CELL_CONTENT`) so styling can be applied consistently between initial render and nested-editor activation.

### Document Selection Over a Widget

A selection spanning a table is drawn by CodeMirror's `.cm-selectionLayer`, which paints at
`z-index: -1` (behind content). Two rules in `tableStyles.ts` keep that the only highlight:

- `::selection` is suppressed inside `CLASS_CELL_CONTENT`. `drawSelection()` only suppresses the
  native highlight under `.cm-line`, and a block widget sits outside every line, so without this
  the browser stacks a second, opaque highlight over the layer. The widget-scoped selector is
  load-bearing: it beats Joplin's own `&.cm-focused ::selection !important` rule on specificity.
- `<th>` drops its background while `spannedTableVisuals.ts` marks the widget spanned, so the
  layer shows through the header row too.

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

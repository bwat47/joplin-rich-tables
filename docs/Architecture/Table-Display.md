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

`buildTableContext()` maintains an **LRU cache** (50 entries) keyed by table-text hash.

Each cache entry stores:

- Parsed `MarkdownTable`.
- Computed `cellRanges`.

`tableWidgetExtension.ts` reuses this shared context when building or rebuilding widgets, instead of parsing table structure and cell ranges independently.

### 4. Height Estimation

Prevents scroll jumping via multi-layered approach:

**Heuristic** (`estimateTableHeight`): Estimates based on row count, text length, image presence.

**ResizeObserver**: After async render:

1. `view.requestMeasure()` notifies CodeMirror.
2. Updates **LRU height cache** (200 entries).

**Height Cache**: Hybrid lookup by position and content hash.

**`coordsAt()`**: Returns cell bounding rectangle for precise scroll-to-cell during navigation.

## Display Modes

### Source Mode

`Ctrl+Shift+/` or toolbar toggle. Disables decoration field, reveals raw Markdown. Auto-closes active nested editor.

See [ADR-004](../ADR/004-global-source-mode.md) for the rationale behind global source mode.

### Search Override

`Ctrl+F` forces raw Markdown mode so native search highlighting works on hidden table text.

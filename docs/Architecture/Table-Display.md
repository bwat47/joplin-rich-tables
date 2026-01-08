# Table Display

## Rendering

### Detection

Lezer syntax tree scanner detects Markdown tables → replaced with `Decoration.replace({ widget, block: true })` via StateField.

### Widget Structure

- `posAtDOM()` locates table widgets.
- Wide tables scroll horizontally within container.

## Optimizations

### 1. Selective Rebuilding

- **Structural Edits**: `rebuildSingleTable()` re-renders affected widget.
- **In-Cell Edits**: No rebuild; decorations mapped to preserve existing DOM.
- **Sync Transactions**: From nested editor explicitly skip rebuilds.

### 2. DOM Reuse (Content Hash)

Each `TableWidget` has `contentHash` (FNV-1a of table text + reference definitions).

On `updateDOM()`:

- Hash matches → DOM reused (return `true`).
- Hash differs → CodeMirror destroys/recreates.

Prevents flicker when rebuilding decorations for position sync.

### 3. Table Parsing Cache

**FIFO cache** (50 entries) of parsed TableData, keyed by content hash.

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

### Search Override

`Ctrl+F` forces raw Markdown mode so native search highlighting works on hidden table text.

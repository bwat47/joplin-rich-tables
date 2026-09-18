# ADR-007: Document Table Index Field

## Status

Accepted

## Context

Table consumers previously resolved syntax independently through `tableResolution.ts`, while `buildTableContext()`
kept a module-level 50-entry LRU and table decorations doubled as a range index. These owners had different timeout,
cache, and invalidation behavior.

The main document is already the authority, and Lezer already reparses incrementally. Maintaining another custom
incremental window or mapped-span algorithm would duplicate membership logic: surrounding Markdown can change whether
later table nodes remain root tables even when their own source is untouched.

## Decision

Register `tableContextField` before dependent main-editor fields and make it the only semantic root-table index. On
creation and every document change it scans the current syntax tree's top-level nodes, which is where every
root table sits. A complete warm tree is read directly;
otherwise `ensureSyntaxTree()` gets the centralized 1000 ms worst-case budget.

Derivation reuse is local to consecutive scans. Exact source text reuses only the normalized `MarkdownTable` and
relative cell ranges; current spans always come from the current tree. Duplicate text discovered during the same scan
shares the same derived values. The global LRU, per-call resolution timeouts, decoration range accessors, and
`tableResolution.ts` are removed.

An unavailable parse publishes an empty index marked incomplete and clears table decorations. This exposes raw
Markdown and destroys any hosted nested editor until a later transaction restores a complete index. Keeping mapped
decorations during timeouts was rejected because it leaves visible widgets without semantic spans for selection and
interaction. `isTableRenderingActive()` separately exposes the document-level rendering state so selection code does
not confuse semantic table presence with visible widgets in raw mode or during a deferred rebuild.

Mapped untouched spans, padded scan windows, retained syntax nodes, and overlap fallbacks were rejected. They add a
second invalidation algorithm and do not reliably account for container and fence changes outside a table's old span.

### Decoration reconciliation

Decorations rebuild from the index by default. The one exception carries the mapped active-table decoration when the
old cell resolves, changes are confined to that cell or strictly outside its table, activation stays in that table, the new
index confirms the mapped span and syntax-derived shape, and the old decoration exists there. This keeps the nested
editor host alive while refreshing every other table. The field records a failed carry-over on a document change as
`activeHostInvalidated`, which the lifecycle consumes directly.

Cell switches and open requests within the same table retain the table DOM. The nested editor controller renders the
departing cell's current content before opening the destination. Clear effects and explicit rebuilds end preservation.

Undo and redo carry the host only for in-cell changes. History restores the selection recorded with the changed text,
so an undo elsewhere should follow that cursor and reopen there rather than preserve a host the lifecycle must discard.
A transaction-wide continuity classifier and isolated reparsing were rejected: both duplicate facts already owned by
the current index and would need separate root-membership validation. Index reconciliation also fixes external edits
to another table remaining visually stale while a cell editor is open.

## Consequences

**Positive:**

- All semantic readers observe one current, root-only table index.
- Duplicate and unchanged table text reuses model/range derivation without process-global cache state.
- Warm point lookup is an indexed read, and rendering stays consistent with the index during parser timeouts.
- Raw-mode and selection behavior explicitly distinguish table presence from rendering availability.
- Active-cell resolution is a plain selector over the index rather than a separately cached state field.
- Widget coordinates resolve live ranges from the index at the DOM position; rendering snapshots cannot supply stale
  coordinate fallbacks.

**Negative:**

- A parser timeout exposes raw Markdown even for visible or active tables. Background parsing may stop before the
  complete document is available, so rendering recovery is not guaranteed to be immediate.
- Every document change rescans the tree's top-level nodes and slices each root table's source for reuse keys.
- Nested-cell edits now pay that scan even though the previous decoration path only mapped widgets.
- States that call semantic selectors must register the field; missing registration fails fast.

### Stage 1 measurement

Measured on 2026-09-17 with Node 22.20.0 and Vitest 4.1.10. Each fixture used 5-column tables with three body rows;
the 200-table document was 28,088 characters and the 1,000-table stress document was 140,888 characters. The values
below are benchmark means in milliseconds and should be treated as local comparative measurements, not absolute user
latency:

| Path                               | 200 tables before | 200 tables Stage 1 | 1,000 tables before | 1,000 tables Stage 1 |
| :--------------------------------- | ----------------: | -----------------: | ------------------: | -------------------: |
| No active cell, paragraph edit     |             0.494 |              0.548 |               2.611 |                2.330 |
| Active table near start, cell edit |             0.296 |              0.566 |               1.358 |                2.288 |
| Raw mode, paragraph edit           |             0.280 |              0.495 |               1.307 |                2.222 |

The common no-active path remained in the same range and was slightly faster on the larger fixture; the active and raw
paths gained the expected full-scan cost. Exact-text reuse-key slicing alone measured 0.032 ms for 200 tables and
0.173 ms for 1,000 tables, so it was not the measured bottleneck and no mapped-span optimization was added.

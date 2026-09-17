# ADR-007: Document Table Index Field

## Status

Accepted

## Context

Table consumers previously resolved syntax independently through `tableResolution.ts`, while `buildTableContext()`
kept a module-level 50-entry LRU and table decorations doubled as a range index. These owners had different timeout,
cache, and invalidation behavior. A syntax timeout could also replace every rendered table with raw Markdown.

The main document is already the authority, and Lezer already reparses incrementally. Maintaining another custom
incremental window or mapped-span algorithm would duplicate membership logic: surrounding Markdown can change whether
later table nodes remain root tables even when their own source is untouched.

## Decision

Register `tableContextField` before dependent main-editor fields and make it the only semantic root-table index. On
creation and every document change it scans the complete current syntax tree. A complete warm tree is read directly;
otherwise `ensureSyntaxTree()` gets the centralized 1000 ms worst-case budget.

Derivation reuse is local to consecutive scans. Exact source text reuses only the normalized `MarkdownTable` and
relative cell ranges; current spans always come from the current tree. Duplicate text discovered during the same scan
shares the same derived values. The global LRU, per-call resolution timeouts, decoration range accessors, and
`tableResolution.ts` are removed.

An unavailable parse publishes an empty index marked incomplete. Semantic selectors therefore never expose stale
spans. If decorations already exist, `tableDecorationField` maps and preserves the complete previous projection until
the parser-progress transaction rebuilds it from a complete index. Raw mode and deliberate clear/rebuild paths outrank
that preservation. `isTableRenderingActive()` separately exposes the document-level rendering state so selection code
does not confuse semantic table presence with visible widgets.

Mapped untouched spans, padded scan windows, retained syntax nodes, and overlap fallbacks were rejected. They add a
second invalidation algorithm and do not reliably account for container and fence changes outside a table's old span.

## Consequences

**Positive:**

- All semantic readers observe one current, root-only table index.
- Duplicate and unchanged table text reuses model/range derivation without process-global cache state.
- Warm point lookup is an indexed read, and timeout recovery cannot blank an existing rendered note.
- Raw-mode and selection behavior explicitly distinguish table presence from rendering availability.

**Negative:**

- Every document change scans the full current tree and slices each root table's source for reuse keys.
- Nested-cell edits now pay that scan even though the previous decoration path only mapped widgets.
- States that call semantic selectors must register the field; missing registration fails fast.

### Stage 1 measurement

Measured on 2026-09-17 with Node 22.20.0 and Vitest 4.1.10. Each fixture used 5-column tables with three body rows;
the 200-table document was 28,088 characters and the 1,000-table stress document was 140,888 characters. The values
below are benchmark means in milliseconds and should be treated as local comparative measurements, not absolute user
latency:

| Path                              | 200 tables before | 200 tables Stage 1 | 1,000 tables before | 1,000 tables Stage 1 |
| :-------------------------------- | ----------------: | -----------------: | ------------------: | -------------------: |
| No active cell, paragraph edit    |             0.494 |              0.548 |               2.611 |                2.330 |
| Active table near start, cell edit |             0.296 |              0.566 |               1.358 |                2.288 |
| Raw mode, paragraph edit          |             0.280 |              0.495 |               1.307 |                2.222 |

The common no-active path remained in the same range and was slightly faster on the larger fixture; the active and raw
paths gained the expected full-scan cost. Exact-text reuse-key slicing alone measured 0.032 ms for 200 tables and
0.173 ms for 1,000 tables, so it was not the measured bottleneck and no mapped-span optimization was added.

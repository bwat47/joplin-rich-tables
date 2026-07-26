import { StateEffect } from '@codemirror/state';

/**
 * Marks a transaction that structurally rewrote a table's source (row/column insert/delete,
 * normalization), so decorations are rebuilt rather than mapped — mapping would leave the
 * rendered HTML table stale.
 *
 * Rebuilds are deliberately document-wide rather than scoped to the mutated table. Rebuilding a
 * decoration does not re-render a widget: `TableWidget.eq()` always returns false and
 * `updateDOM()` reuses the existing DOM whenever the content hash matches, so unchanged tables
 * cost a reparse, not a re-render. Scoping the rebuild would trade that bounded cost for the
 * range-splicing complexity this design exists to avoid.
 *
 * Two consumers also read this effect as a signal that the widget DOM was replaced:
 * `mainEditorGuardPolicy` allows the transaction through without cell-range sanitization, and
 * `tableToolbarPlugin` defers repositioning until the rebuilt DOM exists.
 */
export const rebuildTableWidgetsEffect = StateEffect.define<void>();

/**
 * Forces a rebuild from a transaction that carries no document change, which would otherwise be
 * treated as "keep decorations". Used to recover after an external full-document replace
 * (e.g. a Joplin sync update) once the replacing transaction has settled.
 */
export const rebuildAllTableWidgetsEffect = StateEffect.define<void>();

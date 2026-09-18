import { StateEffect } from '@codemirror/state';

/**
 * Marks a transaction that structurally rewrote a table's source (row/column insert/delete,
 * normalization).
 *
 * Decorations need no special handling: the rewrite replaces the whole table range, so
 * `tableDecorationField` reconciliation sees it touch the table and renders a fresh widget
 * rather than preserving the active host.
 *
 * Two consumers read this effect as a signal that the widget DOM was replaced:
 * `mainEditorGuardPolicy` allows the transaction through without cell-range sanitization, and
 * `tableToolbarPlugin` defers repositioning until the rebuilt DOM exists.
 */
export const structuralTableEditEffect = StateEffect.define<void>();

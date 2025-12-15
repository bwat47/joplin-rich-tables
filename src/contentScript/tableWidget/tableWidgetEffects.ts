import { StateEffect } from '@codemirror/state';

/**
 * Forces table widgets to rebuild on the next transaction.
 *
 * This is used for structural table edits (row/column insert/delete) where mapping existing
 * widget decorations would leave the rendered HTML table stale.
 */
export const rebuildTableWidgetsEffect = StateEffect.define<void>();

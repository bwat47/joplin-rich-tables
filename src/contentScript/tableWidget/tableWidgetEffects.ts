import { StateEffect } from '@codemirror/state';

/**
 * Forces a specific table widget to rebuild on the next transaction.
 * Carries the tableFrom position to identify which table needs rebuilding.
 *
 * This is used for structural table edits (row/column insert/delete) where mapping existing
 * widget decorations would leave the rendered HTML table stale.
 */
export const rebuildTableWidgetsEffect = StateEffect.define<{ tableFrom: number }>();

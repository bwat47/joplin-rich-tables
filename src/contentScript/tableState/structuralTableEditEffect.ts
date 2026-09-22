import { StateEffect } from '@codemirror/state';

/**
 * Marks a transaction produced by a structural table edit or entry normalization.
 *
 * This is only a workflow signal: it does not guarantee a document change, decoration rebuild,
 * or widget DOM replacement. When source text changes, the edit replaces the whole table range,
 * so ordinary decoration reconciliation sees it touch the table and renders a fresh widget.
 * Same-text structural edits may only move the active cell and preserve the existing host.
 *
 * `mainEditorGuardPolicy` uses the signal to allow structural document changes without cell-range
 * sanitization.
 */
export const structuralTableEditEffect = StateEffect.define<null>();

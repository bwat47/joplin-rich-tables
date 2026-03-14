import { Annotation } from '@codemirror/state';
import type { TableContext } from './tableContext';

export const normalizeBeforeEditAnnotation = Annotation.define<boolean>();

/**
 * Returns canonical serialized markdown when the current table text is non-canonical.
 * Passive callers can use this to detect divergence without mutating editor state.
 */
export function getCanonicalTableTextIfChanged(ctx: Pick<TableContext, 'table' | 'text'>): string | null {
    const canonicalText = ctx.table.serialize();
    return canonicalText === ctx.text ? null : canonicalText;
}

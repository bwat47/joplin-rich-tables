import { StateField } from '@codemirror/state';
import { activeCellField, getActiveCell } from '../../tableState/activeCellState';
import { resolveActiveCell, type ResolvedActiveCell } from './activeCellResolver';
import type { EditorState } from '@codemirror/state';

/**
 * Caches the resolved active cell (Lezer tree lookup + cell range derivation) per editor state.
 * CodeMirror reuses this cached value for all readers of the same state, eliminating the
 * 4–5 redundant resolveActiveCell calls that otherwise occur on every keystroke.
 *
 * Resolution depends on the active cell identity and document content, so it is re-derived
 * whenever either changes.
 */
export const resolvedActiveCellField = StateField.define<ResolvedActiveCell | null>({
    create(state) {
        return resolveActiveCell(state, getActiveCell(state));
    },
    update(value, tr) {
        // Re-derive when doc or active cell identity changes.
        if (!tr.docChanged) {
            // Use the false flag so states without activeCellField (e.g. nested editor
            // states, autocomplete states) return undefined instead of throwing.
            if (tr.startState.field(activeCellField, false) === tr.state.field(activeCellField, false)) {
                return value;
            }
        }
        return resolveActiveCell(tr.state, getActiveCell(tr.state));
    },
});

/**
 * Returns the resolved active cell for `state`.
 *
 * When `resolvedActiveCellField` is registered (production), this is a free cached read.
 * Falls back to a fresh computation for states that do not include the field (e.g. isolated
 * test states), so callers remain correct without needing to register the field everywhere.
 */
export function getResolvedActiveCell(state: EditorState): ResolvedActiveCell | null {
    const cached = state.field(resolvedActiveCellField, false);
    if (cached !== undefined) {
        return cached;
    }
    return resolveActiveCell(state, getActiveCell(state));
}

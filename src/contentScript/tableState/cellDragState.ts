import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { getCellSelection } from './cellSelectionState';

export const startCellDragEffect = StateEffect.define<void>();
export const endCellDragEffect = StateEffect.define<void>();

/**
 * Whether the gesture has started a drag and not yet settled it.
 *
 * A drag is only meaningful alongside the selection it is sweeping out. The gesture cannot
 * always dispatch its own end (a plugin destroy hook, for example), so the field also clears
 * itself whenever that selection disappears.
 *
 * Reading `tr.state` computes `cellSelectionField` for this transaction, so that field must
 * never come to depend on this one: CodeMirror throws on a cycle at runtime.
 */
export const cellDragField = StateField.define<boolean>({
    create() {
        return false;
    },
    update(value, tr) {
        let nextValue = value;
        for (const effect of tr.effects) {
            if (effect.is(startCellDragEffect)) {
                nextValue = true;
            } else if (effect.is(endCellDragEffect)) {
                nextValue = false;
            }
        }

        return getCellSelection(tr.state) ? nextValue : false;
    },
});

/**
 * True while a mouse gesture is dragging out a cell selection.
 *
 * The gesture hit-tests the rendered table on every pointer move, so the table's geometry
 * must stay stable until the pointer is released: the runtime defers closing the nested
 * editor, and keyboard handling stays with whoever owned it before the drag.
 *
 * A drag cannot outlive its own selection, which `cellDragField` enforces for itself.
 */
export function isCellDragInProgress(state: EditorState): boolean {
    return state.field(cellDragField, false) ?? false;
}

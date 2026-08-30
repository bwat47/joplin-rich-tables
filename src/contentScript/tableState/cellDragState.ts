import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { getCellSelection } from './cellSelectionState';

export const startCellDragEffect = StateEffect.define<void>();
export const endCellDragEffect = StateEffect.define<void>();

/**
 * Whether the gesture has started a drag and not yet settled it.
 *
 * Read through {@link isCellDragInProgress} rather than directly: a drag is only meaningful
 * alongside the selection it is sweeping out, and the gesture cannot always dispatch its own
 * end (a plugin destroy hook, for example).
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

        return nextValue;
    },
});

/**
 * True while a mouse gesture is dragging out a cell selection.
 *
 * The gesture hit-tests the rendered table on every pointer move, so the table's geometry
 * must stay stable until the pointer is released: the runtime defers closing the nested
 * editor, and keyboard handling stays with whoever owned it before the drag.
 *
 * A drag cannot outlive its own selection. Anything that drops the selection therefore ends
 * the drag too, without `cellSelectionField`'s rules having to be restated here.
 */
export function isCellDragInProgress(state: EditorState): boolean {
    return (state.field(cellDragField, false) ?? false) && getCellSelection(state) !== null;
}

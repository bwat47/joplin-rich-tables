import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { clearCellSelectionEffect } from './cellSelectionState';
import { setActiveCellEffect } from './activeCellState';

export const startCellDragEffect = StateEffect.define<void>();
export const endCellDragEffect = StateEffect.define<void>();

/**
 * True while a mouse gesture is dragging out a cell selection.
 *
 * The gesture hit-tests the rendered table on every pointer move, so the table's geometry
 * must stay stable until the pointer is released: the runtime defers closing the nested
 * editor, and keyboard handling stays with whoever owned it before the drag.
 *
 * The flag also clears on anything that ends a drag's selection, so a gesture torn down
 * without its release event (a plugin reconfigure, for example) cannot strand it.
 */
export const cellDragField = StateField.define<boolean>({
    create() {
        return false;
    },
    update(value, tr) {
        // Last writer wins, matching `cellSelectionField`: one transaction can both reset the
        // cell state and start a drag on top of it.
        let nextValue = value && !tr.docChanged;
        for (const effect of tr.effects) {
            if (effect.is(startCellDragEffect)) {
                nextValue = true;
            } else if (
                effect.is(endCellDragEffect) ||
                effect.is(clearCellSelectionEffect) ||
                effect.is(setActiveCellEffect)
            ) {
                nextValue = false;
            }
        }

        return nextValue;
    },
});

export function isCellDragInProgress(state: EditorState): boolean {
    return state.field(cellDragField, false) ?? false;
}

import { EditorState, StateEffect, StateField } from '@codemirror/state';
import type { CellCoords, TableSection } from '../tableModel/types';

export type ActiveCellSection = TableSection;

export interface ActiveCell extends CellCoords {
    tableFrom: number;
    // section, row, col inherited from CellCoords
}

export function isSameActiveCell(a: ActiveCell | null, b: ActiveCell | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.tableFrom === b.tableFrom && a.section === b.section && a.row === b.row && a.col === b.col;
}

export const setActiveCellEffect = StateEffect.define<ActiveCell>();
export const clearActiveCellEffect = StateEffect.define<void>();

export const activeCellField = StateField.define<ActiveCell | null>({
    create() {
        return null;
    },
    update(value, tr) {
        for (const effect of tr.effects) {
            if (effect.is(clearActiveCellEffect)) {
                return null;
            }
            if (effect.is(setActiveCellEffect)) {
                return effect.value;
            }
        }

        if (!value) {
            return value;
        }

        if (tr.docChanged) {
            // `tableFrom` anchors into the pre-transaction document. A stale anchor can fall
            // outside it, and `mapPos` throws a RangeError for out-of-range positions rather
            // than returning a sentinel, so drop such anchors before mapping.
            if (value.tableFrom < 0 || value.tableFrom > tr.startState.doc.length) {
                return null;
            }

            return {
                ...value,
                tableFrom: tr.changes.mapPos(value.tableFrom, 1),
            };
        }

        return value;
    },
});

export function getActiveCell(state: EditorState): ActiveCell | null {
    return state.field(activeCellField, false) ?? null;
}

import { EditorState, StateEffect, StateField } from '@codemirror/state';
import type { CellCoords, TableSection } from '../tableModel/types';

export type ActiveCellSection = TableSection;

export interface ActiveCell extends CellCoords {
    anchorPos: number;
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
            const mappedAnchorPos = tr.changes.mapPos(value.anchorPos, 1);
            const mappedTableFrom = tr.changes.mapPos(value.tableFrom, 1);
            if (
                !Number.isFinite(mappedAnchorPos) ||
                mappedAnchorPos < 0 ||
                !Number.isFinite(mappedTableFrom) ||
                mappedTableFrom < 0
            ) {
                return null;
            }

            return {
                ...value,
                anchorPos: mappedAnchorPos,
                tableFrom: mappedTableFrom,
            };
        }

        return value;
    },
});

export function getActiveCell(state: EditorState): ActiveCell | null {
    return state.field(activeCellField, false) ?? null;
}

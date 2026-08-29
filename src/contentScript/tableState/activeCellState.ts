import { EditorState, StateEffect, StateField, type ChangeDesc } from '@codemirror/state';
import { isSameCellCoords, type CellCoords } from '../tableModel/types';

export interface ActiveCell extends CellCoords {
    tableFrom: number;
    // section, row, col inherited from CellCoords
}

export function isSameActiveCell(a: ActiveCell | null, b: ActiveCell | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.tableFrom === b.tableFrom && isSameCellCoords(a, b);
}

export const setActiveCellEffect = StateEffect.define<ActiveCell>();
export const clearActiveCellEffect = StateEffect.define<void>();

/**
 * Maps an active-cell anchor from the pre-change document into the changed document.
 *
 * Stale anchors are rejected up front, before `mapPos` can throw for a position outside
 * the pre-change document. `Number.isFinite` is load-bearing here: both range comparisons
 * evaluate false for NaN, so neither one would reject it. Once the anchor is known to be
 * within `[0, changes.length]`, `mapPos` always returns a finite in-document position, so
 * the result needs no further checking.
 */
export function mapActiveCellThroughChanges(activeCell: ActiveCell | null, changes: ChangeDesc): ActiveCell | null {
    if (
        !activeCell ||
        !Number.isFinite(activeCell.tableFrom) ||
        activeCell.tableFrom < 0 ||
        activeCell.tableFrom > changes.length
    ) {
        return null;
    }

    return { ...activeCell, tableFrom: changes.mapPos(activeCell.tableFrom, 1) };
}

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
            return mapActiveCellThroughChanges(value, tr.changes);
        }

        return value;
    },
});

export function getActiveCell(state: EditorState): ActiveCell | null {
    return state.field(activeCellField, false) ?? null;
}

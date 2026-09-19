import { EditorState, StateEffect, StateField, type ChangeDesc } from '@codemirror/state';
import { isSameCellCoords, type CellCoords } from '../tableModel/types';
import { mapTableStartThroughChanges } from './tableStartMapping';

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
 * Stale anchors outside the pre-change document are dropped. Deleting the table's first
 * character keeps the active cell at the deletion point.
 */
export function mapActiveCellThroughChanges(activeCell: ActiveCell | null, changes: ChangeDesc): ActiveCell | null {
    if (!activeCell) {
        return null;
    }

    const tableFrom = mapTableStartThroughChanges(activeCell.tableFrom, changes);
    return tableFrom === null ? null : { ...activeCell, tableFrom };
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

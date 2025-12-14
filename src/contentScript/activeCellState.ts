import { EditorState, StateEffect, StateField } from '@codemirror/state';

export type ActiveCellSection = 'header' | 'body';

export interface ActiveCell {
    tableFrom: number;
    tableTo: number;
    cellFrom: number;
    cellTo: number;
    section: ActiveCellSection;
    row: number; // For body only; 0-based. For header, row is always 0.
    col: number; // 0-based
}

export const setActiveCellEffect = StateEffect.define<ActiveCell>();
export const clearActiveCellEffect = StateEffect.define<void>();

function isValidRange(from: number, to: number): boolean {
    return Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to >= from;
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
            const mappedTableFrom = tr.changes.mapPos(value.tableFrom, -1);
            const mappedTableTo = tr.changes.mapPos(value.tableTo, 1);

            // Use assoc=-1 for 'from' so insertions at start boundary stay visible.
            const mappedCellFrom = tr.changes.mapPos(value.cellFrom, -1);
            // Use assoc=1 for 'to' so insertions at end boundary stay visible.
            const mappedCellTo = tr.changes.mapPos(value.cellTo, 1);

            if (
                !isValidRange(mappedTableFrom, mappedTableTo) ||
                !isValidRange(mappedCellFrom, mappedCellTo) ||
                mappedCellFrom < mappedTableFrom ||
                mappedCellTo > mappedTableTo ||
                mappedCellFrom >= mappedCellTo
            ) {
                return null;
            }

            return {
                ...value,
                tableFrom: mappedTableFrom,
                tableTo: mappedTableTo,
                cellFrom: mappedCellFrom,
                cellTo: mappedCellTo,
            };
        }

        return value;
    },
});

export function getActiveCell(state: EditorState): ActiveCell | null {
    return state.field(activeCellField, false) ?? null;
}

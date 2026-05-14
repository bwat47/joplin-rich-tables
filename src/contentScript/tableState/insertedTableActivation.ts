import { EditorState, StateEffect, StateField, type ChangeDesc } from '@codemirror/state';
import type { CellCoords } from '../tableModel/types';

export interface InsertedTableActivationRequest {
    tableFrom: number;
    target: CellCoords;
}

function mapInsertedTableActivation(
    value: InsertedTableActivationRequest,
    changes: ChangeDesc
): InsertedTableActivationRequest | null {
    let tableStartDeleted = false;
    changes.iterChangedRanges((fromA, toA) => {
        if (fromA <= value.tableFrom && value.tableFrom < toA) {
            tableStartDeleted = true;
        }
    });
    if (tableStartDeleted) {
        return null;
    }

    const tableFrom = changes.mapPos(value.tableFrom, 1);
    if (!Number.isFinite(tableFrom) || tableFrom < 0) {
        return null;
    }

    return { ...value, tableFrom };
}

export const activateInsertedTableEffect = StateEffect.define<InsertedTableActivationRequest>();
export const clearInsertedTableActivationEffect = StateEffect.define<void>();

export const insertedTableActivationField = StateField.define<InsertedTableActivationRequest | null>({
    create() {
        return null;
    },

    update(value, tr) {
        let nextValue = value;

        if (tr.docChanged && nextValue) {
            nextValue = mapInsertedTableActivation(nextValue, tr.changes);
        }

        for (const effect of tr.effects) {
            if (effect.is(activateInsertedTableEffect)) {
                nextValue = effect.value;
                continue;
            }

            if (effect.is(clearInsertedTableActivationEffect)) {
                nextValue = null;
            }
        }

        return nextValue;
    },
});

export function getPendingInsertedTableActivation(state: EditorState): InsertedTableActivationRequest | null {
    return state.field(insertedTableActivationField, false) ?? null;
}

import { EditorState, StateEffect, StateField, type ChangeDesc } from '@codemirror/state';
import type { CellCoords } from '../tableModel/types';
import { mapTableStartThroughChanges } from './tableStartMapping';

export interface InsertedTableActivationRequest {
    tableFrom: number;
    target: CellCoords;
}

function mapInsertedTableActivation(
    value: InsertedTableActivationRequest,
    changes: ChangeDesc
): InsertedTableActivationRequest | null {
    const tableFrom = mapTableStartThroughChanges(value.tableFrom, changes);

    return tableFrom === null ? null : { ...value, tableFrom };
}

export const activateInsertedTableEffect = StateEffect.define<InsertedTableActivationRequest>();
export const clearInsertedTableActivationEffect = StateEffect.define<void>();

export const insertedTableActivationField = StateField.define<InsertedTableActivationRequest | null>({
    create() {
        return null;
    },

    update(value, tr) {
        let nextValue = value;

        // Map only the already-pending request. New activation effects carry
        // post-change positions from their originating transaction.
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

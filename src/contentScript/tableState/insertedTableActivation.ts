import { StateEffect } from '@codemirror/state';
import type { CellCoords } from '../tableModel/types';

export interface InsertedTableActivationRequest {
    tableFrom: number;
    target: CellCoords;
}

export const activateInsertedTableEffect = StateEffect.define<InsertedTableActivationRequest>({
    map(value, changes) {
        const tableFrom = changes.mapPos(value.tableFrom, 1);
        if (!Number.isFinite(tableFrom) || tableFrom < 0) return undefined;
        return { ...value, tableFrom };
    },
});

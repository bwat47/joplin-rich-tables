import { StateEffect } from '@codemirror/state';
import type { CellCoords } from '../tableModel/types';

export interface InsertedTableActivationRequest {
    tableFrom: number;
    target: CellCoords;
}

export const activateInsertedTableEffect = StateEffect.define<InsertedTableActivationRequest>();

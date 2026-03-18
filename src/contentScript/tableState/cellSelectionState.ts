import { Annotation, EditorState, StateEffect, StateField } from '@codemirror/state';
import type { CellCoords, TableRect } from '../tableModel/types';

export interface CellSelection {
    tableFrom: number;
    anchor: CellCoords;
    focus: CellCoords;
}

export type SelectionRect = TableRect;
export type CellSelectionDirection = 'left' | 'right' | 'up' | 'down';

export const cellSelectionTransitionAnnotation = Annotation.define<boolean>();
export const setCellSelectionEffect = StateEffect.define<CellSelection>();
export const clearCellSelectionEffect = StateEffect.define<void>();

export function toUnifiedRow(coords: CellCoords): number {
    return coords.section === 'header' ? 0 : coords.row + 1;
}

export function fromUnifiedRow(row: number, col: number): CellCoords {
    if (row <= 0) {
        return { section: 'header', row: 0, col };
    }

    return { section: 'body', row: row - 1, col };
}

export function toSelectionRect(selection: CellSelection): SelectionRect {
    const anchorRow = toUnifiedRow(selection.anchor);
    const focusRow = toUnifiedRow(selection.focus);

    return {
        minRow: Math.min(anchorRow, focusRow),
        maxRow: Math.max(anchorRow, focusRow),
        minCol: Math.min(selection.anchor.col, selection.focus.col),
        maxCol: Math.max(selection.anchor.col, selection.focus.col),
    };
}

export function selectionFromRect(tableFrom: number, rect: SelectionRect): CellSelection {
    return {
        tableFrom,
        anchor: fromUnifiedRow(rect.minRow, rect.minCol),
        focus: fromUnifiedRow(rect.maxRow, rect.maxCol),
    };
}

export function isCellInRect(rect: SelectionRect, coords: CellCoords): boolean {
    const unifiedRow = toUnifiedRow(coords);

    return (
        unifiedRow >= rect.minRow && unifiedRow <= rect.maxRow && coords.col >= rect.minCol && coords.col <= rect.maxCol
    );
}

export function getCellSelection(state: EditorState): CellSelection | null {
    return state.field(cellSelectionField, false) ?? null;
}

export const cellSelectionField = StateField.define<CellSelection | null>({
    create() {
        return null;
    },
    update(value, tr) {
        let nextValue = value;
        let sawSetSelectionEffect = false;

        for (const effect of tr.effects) {
            if (effect.is(clearCellSelectionEffect)) {
                nextValue = null;
                continue;
            }

            if (effect.is(setCellSelectionEffect)) {
                nextValue = effect.value;
                sawSetSelectionEffect = true;
            }
        }

        if (tr.docChanged && !sawSetSelectionEffect) {
            return null;
        }

        return nextValue;
    },
});

export function normalizeCellCoords(coords: CellCoords): CellCoords {
    return {
        section: coords.section,
        row: coords.section === 'header' ? 0 : coords.row,
        col: coords.col,
    };
}

export function moveCellCoords(coords: CellCoords, direction: CellSelectionDirection): CellCoords {
    const unifiedRow = toUnifiedRow(coords);

    switch (direction) {
        case 'left':
            return fromUnifiedRow(unifiedRow, coords.col - 1);
        case 'right':
            return fromUnifiedRow(unifiedRow, coords.col + 1);
        case 'up':
            return fromUnifiedRow(unifiedRow - 1, coords.col);
        case 'down':
            return fromUnifiedRow(unifiedRow + 1, coords.col);
    }
}

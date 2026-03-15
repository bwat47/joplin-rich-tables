import { Annotation, EditorSelection, EditorState, StateEffect, StateField } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { clearActiveCellEffect, getActiveCell, setActiveCellEffect } from './activeCellState';
import { resolveTableContextAtPos, resolveCellDocRange } from './tablePositioning';
import type { CellCoords, TableRect } from '../tableModel/types';

export interface CellSelection {
    tableFrom: number;
    anchor: CellCoords;
    focus: CellCoords;
}

export type SelectionRect = TableRect;

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
            if (effect.is(clearCellSelectionEffect) || effect.is(setActiveCellEffect)) {
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

function toCellCoords(coords: CellCoords): CellCoords {
    return {
        section: coords.section,
        row: coords.section === 'header' ? 0 : coords.row,
        col: coords.col,
    };
}

function getTableBounds(state: EditorState, tableFrom: number): { totalRows: number; totalCols: number } | null {
    const ctx = resolveTableContextAtPos(state, tableFrom);
    if (!ctx) {
        return null;
    }

    return {
        totalRows: 1 + ctx.cellRanges.rows.length,
        totalCols: ctx.cellRanges.headers.length,
    };
}

function clampSelectionFocus(state: EditorState, tableFrom: number, focus: CellCoords): CellCoords | null {
    const bounds = getTableBounds(state, tableFrom);
    if (!bounds || bounds.totalCols <= 0) {
        return null;
    }

    const unifiedRow = Math.max(0, Math.min(bounds.totalRows - 1, toUnifiedRow(focus)));
    const col = Math.max(0, Math.min(bounds.totalCols - 1, focus.col));

    return fromUnifiedRow(unifiedRow, col);
}

export function moveCellCoords(coords: CellCoords, direction: 'left' | 'right' | 'up' | 'down'): CellCoords {
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

function dispatchSelection(view: EditorView, selection: CellSelection, options: { clearActiveCell: boolean }): boolean {
    const ctx = resolveTableContextAtPos(view.state, selection.tableFrom);
    if (!ctx) {
        return false;
    }

    const focusRange = resolveCellDocRange({
        tableFrom: ctx.from,
        ranges: ctx.cellRanges,
        coords: selection.focus,
    });
    if (!focusRange) {
        return false;
    }

    view.dispatch({
        selection: EditorSelection.single(focusRange.cellFrom),
        effects: [
            setCellSelectionEffect.of({
                tableFrom: ctx.from,
                anchor: toCellCoords(selection.anchor),
                focus: toCellCoords(selection.focus),
            }),
            ...(options.clearActiveCell ? [clearActiveCellEffect.of(undefined)] : []),
        ],
        annotations: cellSelectionTransitionAnnotation.of(true),
        scrollIntoView: false,
    });

    return true;
}

export function startCellSelectionFromActiveCell(
    view: EditorView,
    direction: 'left' | 'right' | 'up' | 'down'
): boolean {
    const activeCell = getActiveCell(view.state);
    if (!activeCell) {
        return false;
    }

    const clampedFocus = clampSelectionFocus(view.state, activeCell.tableFrom, moveCellCoords(activeCell, direction));
    if (!clampedFocus) {
        return false;
    }

    return dispatchSelection(
        view,
        {
            tableFrom: activeCell.tableFrom,
            anchor: activeCell,
            focus: clampedFocus,
        },
        { clearActiveCell: true }
    );
}

export function extendExistingCellSelection(view: EditorView, direction: 'left' | 'right' | 'up' | 'down'): boolean {
    const selection = getCellSelection(view.state);
    if (!selection) {
        return false;
    }

    const clampedFocus = clampSelectionFocus(
        view.state,
        selection.tableFrom,
        moveCellCoords(selection.focus, direction)
    );
    if (!clampedFocus) {
        return false;
    }

    return dispatchSelection(
        view,
        {
            tableFrom: selection.tableFrom,
            anchor: selection.anchor,
            focus: clampedFocus,
        },
        { clearActiveCell: false }
    );
}

export function setOrExtendCellSelectionToCoords(view: EditorView, focus: CellCoords, tableFrom: number): boolean {
    const selection = getCellSelection(view.state);
    if (selection && selection.tableFrom === tableFrom) {
        const clampedFocus = clampSelectionFocus(view.state, selection.tableFrom, focus);
        if (!clampedFocus) {
            return false;
        }

        return dispatchSelection(
            view,
            {
                tableFrom: selection.tableFrom,
                anchor: selection.anchor,
                focus: clampedFocus,
            },
            { clearActiveCell: false }
        );
    }

    const activeCell = getActiveCell(view.state);
    if (activeCell && activeCell.tableFrom === tableFrom) {
        const clampedFocus = clampSelectionFocus(view.state, activeCell.tableFrom, focus);
        if (!clampedFocus) {
            return false;
        }

        return dispatchSelection(
            view,
            {
                tableFrom: activeCell.tableFrom,
                anchor: activeCell,
                focus: clampedFocus,
            },
            { clearActiveCell: true }
        );
    }

    return false;
}

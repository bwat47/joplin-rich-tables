import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { clearActiveCellEffect, getActiveCell } from '../../tableState/activeCellState';
import {
    cellSelectionTransitionAnnotation,
    fromUnifiedRow,
    getCellSelection,
    moveCellCoords,
    normalizeCellCoords,
    setCellSelectionEffect,
    toUnifiedRow,
    type CellSelection,
    type CellSelectionDirection,
} from '../../tableState/cellSelectionState';
import { resolveCellDocRange, resolveTableContextAtPos } from '../tablePositioning';
import { makeTableId, type CellCoords } from '../../tableModel/types';
import { findCellElement } from '../../tableWidget/domHelpers';

function getTableBounds(view: EditorView, tableFrom: number): { totalRows: number; totalCols: number } | null {
    const ctx = resolveTableContextAtPos(view.state, tableFrom);
    if (!ctx) {
        return null;
    }

    return {
        totalRows: 1 + ctx.cellRanges.rows.length,
        totalCols: ctx.cellRanges.headers.length,
    };
}

function clampSelectionFocus(view: EditorView, tableFrom: number, focus: CellCoords): CellCoords | null {
    const bounds = getTableBounds(view, tableFrom);
    if (!bounds || bounds.totalCols <= 0) {
        return null;
    }

    const unifiedRow = Math.max(0, Math.min(bounds.totalRows - 1, toUnifiedRow(focus)));
    const col = Math.max(0, Math.min(bounds.totalCols - 1, focus.col));

    return fromUnifiedRow(unifiedRow, col);
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
                anchor: normalizeCellCoords(selection.anchor),
                focus: normalizeCellCoords(selection.focus),
            }),
            ...(options.clearActiveCell ? [clearActiveCellEffect.of(undefined)] : []),
        ],
        annotations: cellSelectionTransitionAnnotation.of(true),
        scrollIntoView: false,
    });

    const cellElement = findCellElement(view, makeTableId(ctx.from), selection.focus);
    if (cellElement) {
        view.requestMeasure({
            read: () => cellElement.isConnected,
            write: (isConnected) => {
                if (isConnected) {
                    cellElement.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                }
            },
        });
    }

    return true;
}

export function startCellSelectionFromActiveCell(view: EditorView, direction: CellSelectionDirection): boolean {
    const activeCell = getActiveCell(view.state);
    if (!activeCell) {
        return false;
    }

    const clampedFocus = clampSelectionFocus(view, activeCell.tableFrom, moveCellCoords(activeCell, direction));
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

export function extendExistingCellSelection(view: EditorView, direction: CellSelectionDirection): boolean {
    const selection = getCellSelection(view.state);
    if (!selection) {
        return false;
    }

    const clampedFocus = clampSelectionFocus(view, selection.tableFrom, moveCellCoords(selection.focus, direction));
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
        const clampedFocus = clampSelectionFocus(view, selection.tableFrom, focus);
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
        const clampedFocus = clampSelectionFocus(view, activeCell.tableFrom, focus);
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

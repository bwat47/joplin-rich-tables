import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { clearActiveCellEffect } from '../../tableState/activeCellState';
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
import type { TableContext } from '../../tableModel/tableContext';
import { clamp } from '../../shared/numberUtils';
import { resolveCellDocRange, resolveTableContextAtPos } from '../tableResolution';
import { makeTableId, type CellCoords } from '../../tableModel/types';
import { findCellElement } from '../../tableWidget/domHelpers';
import { getResolvedActiveCell } from '../activeCell/resolvedActiveCell';

function getTableBoundsFromContext(ctx: TableContext): { totalRows: number; totalCols: number } {
    return {
        totalRows: 1 + ctx.cellRanges.rows.length,
        totalCols: ctx.cellRanges.headers.length,
    };
}

function clampSelectionFocusWithinContext(ctx: TableContext, focus: CellCoords): CellCoords | null {
    const bounds = getTableBoundsFromContext(ctx);
    if (bounds.totalCols <= 0) {
        return null;
    }

    const unifiedRow = clamp(toUnifiedRow(focus), 0, bounds.totalRows - 1);
    const col = clamp(focus.col, 0, bounds.totalCols - 1);

    return fromUnifiedRow(unifiedRow, col);
}

function clampSelectionFocus(view: EditorView, tableFrom: number, focus: CellCoords): CellCoords | null {
    const ctx = resolveTableContextAtPos(view.state, tableFrom);
    if (!ctx) {
        return null;
    }

    return clampSelectionFocusWithinContext(ctx, focus);
}

function dispatchSelectionWithContext(
    view: EditorView,
    ctx: TableContext,
    selection: CellSelection,
    options: { clearActiveCell: boolean }
): boolean {
    const focusRange = resolveCellDocRange({
        tableFrom: ctx.from,
        ranges: ctx.cellRanges,
        coords: selection.focus,
    });
    if (!focusRange) {
        return false;
    }

    view.dispatch({
        selection: EditorSelection.single(focusRange.editableFrom),
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

function dispatchSelection(view: EditorView, selection: CellSelection, options: { clearActiveCell: boolean }): boolean {
    const ctx = resolveTableContextAtPos(view.state, selection.tableFrom);
    if (!ctx) {
        return false;
    }

    return dispatchSelectionWithContext(view, ctx, selection, options);
}

export function startCellSelectionFromActiveCell(view: EditorView, direction: CellSelectionDirection): boolean {
    const resolvedActiveCell = getResolvedActiveCell(view.state);
    if (!resolvedActiveCell) {
        return false;
    }

    const activeCell = resolvedActiveCell.activeCell;
    const clampedFocus = clampSelectionFocusWithinContext(
        resolvedActiveCell.ctx,
        moveCellCoords(activeCell, direction)
    );
    if (!clampedFocus) {
        return false;
    }

    return dispatchSelectionWithContext(
        view,
        resolvedActiveCell.ctx,
        {
            tableFrom: resolvedActiveCell.tableFrom,
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

    const resolvedActiveCell = getResolvedActiveCell(view.state);
    if (resolvedActiveCell && resolvedActiveCell.tableFrom === tableFrom) {
        const activeCell = resolvedActiveCell.activeCell;
        const clampedFocus = clampSelectionFocusWithinContext(resolvedActiveCell.ctx, focus);
        if (!clampedFocus) {
            return false;
        }

        return dispatchSelectionWithContext(
            view,
            resolvedActiveCell.ctx,
            {
                tableFrom: resolvedActiveCell.tableFrom,
                anchor: activeCell,
                focus: clampedFocus,
            },
            { clearActiveCell: true }
        );
    }

    return false;
}

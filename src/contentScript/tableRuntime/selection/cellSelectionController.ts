import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { clearActiveCellEffect } from '../../tableState/activeCellState';
import {
    cellSelectionTransitionAnnotation,
    clearCellSelectionEffect,
    fromUnifiedRow,
    getCellSelection,
    moveCellCoords,
    normalizeCellCoords,
    setCellSelectionEffect,
    toUnifiedRow,
    type CellSelection,
    type CellSelectionDirection,
} from '../../tableState/cellSelectionState';
import { getTableGridBounds, type TableContext } from '../../tableModel/tableContext';
import { clamp } from '../../shared/numberUtils';
import { resolveCellDocRange, resolveTableContextAtPos } from '../tableResolution';
import { isSameCellCoords, makeTableId, type CellCoords } from '../../tableModel/types';
import { findCellElement } from '../../tableWidget/domHelpers';
import { createResolvedActiveCell, getResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { exitTableToAdjacentLine, type TableExitSide } from '../navigation/tableExit';
import { requestOpenCell } from '../openCellRequest';

function clampSelectionFocusWithinContext(ctx: TableContext, focus: CellCoords): CellCoords | null {
    const bounds = getTableGridBounds(ctx);
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
    options: { clearActiveCell: boolean; scrollFocusIntoView?: boolean }
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

    const cellElement =
        (options.scrollFocusIntoView ?? true) ? findCellElement(view, makeTableId(ctx.from), selection.focus) : null;
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

function dispatchSelection(
    view: EditorView,
    selection: CellSelection,
    options: { clearActiveCell: boolean; scrollFocusIntoView?: boolean }
): boolean {
    const ctx = resolveTableContextAtPos(view.state, selection.tableFrom);
    if (!ctx) {
        return false;
    }

    return dispatchSelectionWithContext(view, ctx, selection, options);
}

/** Replaces the current selection with an explicit rectangle, such as a mouse drag. */
export function setCellSelectionFromCoords(
    view: EditorView,
    tableFrom: number,
    anchor: CellCoords,
    focus: CellCoords,
    options: { scrollFocusIntoView: boolean }
): boolean {
    const ctx = resolveTableContextAtPos(view.state, tableFrom);
    if (!ctx) {
        return false;
    }

    const clampedAnchor = clampSelectionFocusWithinContext(ctx, anchor);
    const clampedFocus = clampSelectionFocusWithinContext(ctx, focus);
    if (!clampedAnchor || !clampedFocus) {
        return false;
    }

    return dispatchSelectionWithContext(
        view,
        ctx,
        {
            tableFrom: ctx.from,
            anchor: clampedAnchor,
            focus: clampedFocus,
        },
        {
            clearActiveCell: true,
            scrollFocusIntoView: options.scrollFocusIntoView,
        }
    );
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

    if (!isSameCellCoords(selection.focus, selection.anchor) && isSameCellCoords(clampedFocus, selection.anchor)) {
        const ctx = resolveTableContextAtPos(view.state, selection.tableFrom);
        const resolvedAnchor = ctx ? createResolvedActiveCell({ ctx, coords: selection.anchor }) : null;
        if (resolvedAnchor) {
            requestOpenCell(view, {
                resolvedCell: resolvedAnchor,
                clearCellSelection: true,
            });
            return true;
        }
        // Without a resolvable anchor, fall through and just contract the selection.
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

function exitSideForDirection(direction: CellSelectionDirection): TableExitSide {
    return direction === 'up' || direction === 'left' ? 'before' : 'after';
}

/**
 * Collapses a cell selection the way an unmodified arrow key collapses a text selection:
 * the highlight is dropped and the caret lands outside the table, on the side the arrow
 * points toward.
 *
 * Reports whether the key was consumed rather than whether the caret moved. A table
 * pressed against a document edge has no adjacent line to move to, but the selection
 * still has to go — letting the key fall through to the main editor there would move the
 * caret around inside the table's hidden Markdown with the highlight left behind.
 */
export function collapseCellSelectionOutOfTable(view: EditorView, direction: CellSelectionDirection): boolean {
    const selection = getCellSelection(view.state);
    if (!selection) {
        return false;
    }

    const ctx = resolveTableContextAtPos(view.state, selection.tableFrom);
    if (!ctx) {
        return false;
    }

    const effects = [clearCellSelectionEffect.of(undefined)];
    if (!exitTableToAdjacentLine(view, ctx, exitSideForDirection(direction), effects)) {
        view.dispatch({ effects });
    }

    return true;
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

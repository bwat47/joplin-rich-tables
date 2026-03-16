import type { EditorState } from '@codemirror/state';
import { resolveCellDocRange, resolveTableContextAtPos } from './tablePositioning';
import { getActiveCell, type ActiveCell } from '../tableState/activeCellState';
import type { TableContext } from '../tableModel/tableContext';

export interface ResolvedActiveCell {
    activeCell: ActiveCell;
    ctx: TableContext;
    tableFrom: number;
    tableTo: number;
    cellFrom: number;
    cellTo: number;
}

function expandCellEndForTrailingWhitespace(
    state: EditorState,
    range: { cellFrom: number; cellTo: number }
): { cellFrom: number; cellTo: number } {
    const selection = state.selection.main;
    const maxSelectionPos = Math.max(selection.anchor, selection.head);

    if (maxSelectionPos <= range.cellTo) {
        return range;
    }

    const line = state.doc.lineAt(range.cellTo);
    if (maxSelectionPos > line.to) {
        return range;
    }

    let expandedCellTo = range.cellTo;
    while (expandedCellTo < line.to && /\s/.test(state.doc.sliceString(expandedCellTo, expandedCellTo + 1))) {
        expandedCellTo++;
    }

    if (expandedCellTo === range.cellTo) {
        return range;
    }

    const nextChar = expandedCellTo < line.to ? state.doc.sliceString(expandedCellTo, expandedCellTo + 1) : '';
    if (nextChar && nextChar !== '|') {
        return range;
    }

    if (maxSelectionPos > expandedCellTo) {
        return range;
    }

    return {
        cellFrom: range.cellFrom,
        cellTo: expandedCellTo,
    };
}

export function resolveActiveCell(state: EditorState, activeCell: ActiveCell | null): ResolvedActiveCell | null {
    if (!activeCell) {
        return null;
    }

    const lookupPos = Math.min(Math.max(activeCell.anchorPos, 0), state.doc.length);
    const ctx = resolveTableContextAtPos(state, lookupPos);
    if (!ctx) {
        return null;
    }

    const range = resolveCellDocRange({
        tableFrom: ctx.from,
        ranges: ctx.cellRanges,
        coords: activeCell,
    });
    if (!range) {
        return null;
    }

    const expandedRange = expandCellEndForTrailingWhitespace(state, range);

    return {
        activeCell: {
            ...activeCell,
            tableFrom: ctx.from,
        },
        ctx,
        tableFrom: ctx.from,
        tableTo: ctx.to,
        cellFrom: expandedRange.cellFrom,
        cellTo: expandedRange.cellTo,
    };
}

export function resolveCurrentActiveCell(state: EditorState): ResolvedActiveCell | null {
    return resolveActiveCell(state, getActiveCell(state));
}

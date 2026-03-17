import type { EditorState } from '@codemirror/state';
import { resolveCellDocRange, resolveTableContextAtPos } from './tablePositioning';
import type { ActiveCell } from '../tableState/activeCellState';
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

function clampDocPos(state: EditorState, pos: number): number {
    return Math.min(Math.max(pos, 0), state.doc.length);
}

function resolveTableForActiveCell(state: EditorState, activeCell: ActiveCell): {
    ctx: TableContext;
    tableFrom: number;
    tableTo: number;
    cellFrom: number;
    cellTo: number;
} | null {
    const candidatePositions = [activeCell.tableFrom, activeCell.anchorPos].map((pos) => clampDocPos(state, pos));
    const seenPositions = new Set<number>();

    for (const pos of candidatePositions) {
        if (seenPositions.has(pos)) {
            continue;
        }
        seenPositions.add(pos);

        const ctx = resolveTableContextAtPos(state, pos);
        if (!ctx) {
            continue;
        }

        const range = resolveCellDocRange({
            tableFrom: ctx.from,
            ranges: ctx.cellRanges,
            coords: activeCell,
        });
        if (!range) {
            continue;
        }

        return {
            ctx,
            tableFrom: ctx.from,
            tableTo: ctx.to,
            cellFrom: range.cellFrom,
            cellTo: range.cellTo,
        };
    }

    return null;
}

export function resolveActiveCell(state: EditorState, activeCell: ActiveCell | null): ResolvedActiveCell | null {
    if (!activeCell) {
        return null;
    }

    const resolved = resolveTableForActiveCell(state, activeCell);
    if (!resolved) {
        return null;
    }

    const expandedRange = expandCellEndForTrailingWhitespace(state, resolved);

    return {
        activeCell: {
            ...activeCell,
            tableFrom: resolved.tableFrom,
        },
        ctx: resolved.ctx,
        tableFrom: resolved.tableFrom,
        tableTo: resolved.tableTo,
        cellFrom: expandedRange.cellFrom,
        cellTo: expandedRange.cellTo,
    };
}

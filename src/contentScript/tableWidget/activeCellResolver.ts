import type { EditorState } from '@codemirror/state';
import { resolveCellDocRange, resolveTableContextAtPos } from './tablePositioning';
import { getActiveCell, type ActiveCell } from './activeCellState';
import { buildTableContext, type TableContext } from '../tableModel/tableContext';

function resolveTableContextAtExactFrom(state: EditorState, tableFrom: number): TableContext | null {
    if (tableFrom < 0 || tableFrom >= state.doc.length) {
        return null;
    }

    const firstLine = state.doc.lineAt(tableFrom);
    if (firstLine.from !== tableFrom) {
        return null;
    }

    const lines: string[] = [];
    for (let lineNo = firstLine.number; lineNo <= state.doc.lines; lineNo++) {
        const line = state.doc.line(lineNo).text;
        if (lines.length >= 2 && !line.includes('|')) {
            break;
        }
        lines.push(line);
    }

    if (lines.length < 2) {
        return null;
    }

    const text = lines.join('\n');
    return buildTableContext({ from: tableFrom, to: tableFrom + text.length, text });
}

export interface ResolvedActiveCell {
    activeCell: ActiveCell;
    ctx: TableContext;
    tableFrom: number;
    tableTo: number;
    cellFrom: number;
    cellTo: number;
}

export function resolveActiveCell(state: EditorState, activeCell: ActiveCell | null): ResolvedActiveCell | null {
    if (!activeCell) {
        return null;
    }

    const lookupPos = Math.min(activeCell.tableFrom + 1, state.doc.length);
    const ctx =
        resolveTableContextAtPos(state, lookupPos) ?? resolveTableContextAtExactFrom(state, activeCell.tableFrom);
    if (!ctx || ctx.from !== activeCell.tableFrom) {
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

    return {
        activeCell,
        ctx,
        tableFrom: ctx.from,
        tableTo: ctx.to,
        cellFrom: range.cellFrom,
        cellTo: range.cellTo,
    };
}

export function resolveCurrentActiveCell(state: EditorState): ResolvedActiveCell | null {
    return resolveActiveCell(state, getActiveCell(state));
}

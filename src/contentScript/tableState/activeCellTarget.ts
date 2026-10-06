import type { SerializedTable } from '../tableModel/MarkdownTable';
import { computeCellAnchorForTable, type TableCellAnchor } from '../tableModel/cellAnchors';
import type { CellCoords } from '../tableModel/types';
import type { ActiveCell } from './activeCellState';

export interface ActiveCellSelectionTarget {
    activeCell: ActiveCell;
    selectionAnchor: number;
}

function toActiveCellSelectionTarget(tableFrom: number, anchor: TableCellAnchor): ActiveCellSelectionTarget {
    return {
        activeCell: {
            tableFrom,
            section: anchor.section,
            row: anchor.row,
            col: anchor.col,
        },
        selectionAnchor: tableFrom + anchor.anchorOffset,
    };
}

export function createActiveCellForTable(params: {
    tableFrom: number;
    serialized: SerializedTable;
    target: CellCoords;
}): ActiveCellSelectionTarget | null {
    const anchor = computeCellAnchorForTable({
        serialized: params.serialized,
        target: params.target,
    });
    return anchor ? toActiveCellSelectionTarget(params.tableFrom, anchor) : null;
}

/** Active cell for a newly written table, targeting its first header cell. */
export function createFirstActiveCellForTable(params: {
    tableFrom: number;
    serialized: SerializedTable;
}): ActiveCellSelectionTarget | null {
    return createActiveCellForTable({
        tableFrom: params.tableFrom,
        serialized: params.serialized,
        target: { section: 'header', row: 0, col: 0 },
    });
}

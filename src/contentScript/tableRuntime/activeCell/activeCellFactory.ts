import type { TableCellRanges } from '../../tableModel/markdownTableCellRanges';
import {
    computeCellAnchorForTableText,
    computeCellAnchorFromRanges,
    type TargetCell,
    type TableCellAnchor,
} from '../../tableModel/activeCellForTableText';
import type { ActiveCell } from '../../tableState/activeCellState';

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

export function createActiveCellFromRanges(params: {
    tableFrom: number;
    ranges: TableCellRanges;
    target: TargetCell;
}): ActiveCellSelectionTarget | null {
    const anchor = computeCellAnchorFromRanges({
        ranges: params.ranges,
        target: params.target,
    });
    return anchor ? toActiveCellSelectionTarget(params.tableFrom, anchor) : null;
}

export function createActiveCellForTableText(params: {
    tableFrom: number;
    tableText: string;
    target: TargetCell;
}): ActiveCellSelectionTarget | null {
    const anchor = computeCellAnchorForTableText({
        tableText: params.tableText,
        target: params.target,
    });
    return anchor ? toActiveCellSelectionTarget(params.tableFrom, anchor) : null;
}

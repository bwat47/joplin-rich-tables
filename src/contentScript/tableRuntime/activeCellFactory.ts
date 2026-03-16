import type { TableCellRanges } from '../tableModel/markdownTableCellRanges';
import {
    computeCellAnchorForTableText,
    computeCellAnchorFromRanges,
    type TargetCell,
    type TableCellAnchor,
} from '../tableModel/activeCellForTableText';
import type { ActiveCell } from '../tableState/activeCellState';

function toActiveCell(tableFrom: number, anchor: TableCellAnchor): ActiveCell {
    return {
        anchorPos: tableFrom + anchor.anchorOffset,
        tableFrom,
        section: anchor.section,
        row: anchor.row,
        col: anchor.col,
    };
}

export function createActiveCellFromRanges(params: {
    tableFrom: number;
    ranges: TableCellRanges;
    target: TargetCell;
}): ActiveCell | null {
    const anchor = computeCellAnchorFromRanges({
        ranges: params.ranges,
        target: params.target,
    });
    return anchor ? toActiveCell(params.tableFrom, anchor) : null;
}

export function createActiveCellForTableText(params: {
    tableFrom: number;
    tableText: string;
    target: TargetCell;
}): ActiveCell | null {
    const anchor = computeCellAnchorForTableText({
        tableText: params.tableText,
        target: params.target,
    });
    return anchor ? toActiveCell(params.tableFrom, anchor) : null;
}

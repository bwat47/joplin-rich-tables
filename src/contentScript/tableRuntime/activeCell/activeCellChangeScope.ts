import type { ChangeSet } from '@codemirror/state';

export interface ActiveCellSpan {
    tableFrom: number;
    tableTo: number;
    editableFrom: number;
    editableTo: number;
}

export type ActiveCellChangeScope = 'inCell' | 'outsideTable' | 'touchesTable';

function isInsideEditableSpan(from: number, to: number, span: ActiveCellSpan): boolean {
    return from >= span.editableFrom && to <= span.editableTo;
}

function isStrictlyOutsideTable(from: number, to: number, span: ActiveCellSpan): boolean {
    return to < span.tableFrom || from > span.tableTo;
}

/** Classifies changes in start-document coordinates against an active cell's spans. */
export function classifyActiveCellChanges(changes: ChangeSet, span: ActiveCellSpan): ActiveCellChangeScope {
    let hasOutsideTableChange = false;
    let touchesTableOutsideCell = false;

    changes.iterChanges((from, to) => {
        if (touchesTableOutsideCell || isInsideEditableSpan(from, to, span)) {
            return;
        }
        if (isStrictlyOutsideTable(from, to, span)) {
            hasOutsideTableChange = true;
            return;
        }
        touchesTableOutsideCell = true;
    });

    if (touchesTableOutsideCell) {
        return 'touchesTable';
    }
    return hasOutsideTableChange ? 'outsideTable' : 'inCell';
}

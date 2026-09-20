import type { ChangeSet } from '@codemirror/state';
import { rangeTouchesInclusive } from '../../shared/transactionUtils';
import type { TableContext } from '../../tableModel/tableContext';

/** The spans of an active cell and its table; a `ResolvedActiveCell` satisfies it. */
export interface ActiveCellSpan {
    ctx: Pick<TableContext, 'from' | 'to'>;
    editableFrom: number;
    editableTo: number;
}

export type ActiveCellChangeScope = 'inCell' | 'outsideTable' | 'touchesTable';

function isInsideEditableSpan(from: number, to: number, span: ActiveCellSpan): boolean {
    return from >= span.editableFrom && to <= span.editableTo;
}

function isStrictlyOutsideTable(from: number, to: number, span: ActiveCellSpan): boolean {
    return !rangeTouchesInclusive(from, to, span.ctx.from, span.ctx.to);
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

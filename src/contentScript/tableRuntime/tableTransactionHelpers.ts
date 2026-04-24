import { ChangeSet, EditorSelection, SelectionRange, Transaction } from '@codemirror/state';
import { type ResolvedActiveCell } from './activeCell/resolvedActiveCell';
import { isStructuralTableChange } from './lifecycle/structuralChangeDetection';

export function transactionRequiresTableRebuild(tr: Transaction, activeCell: ResolvedActiveCell | null): boolean {
    if (!activeCell) {
        return false;
    }

    if (!tr.isUserEvent('undo') && !tr.isUserEvent('redo')) {
        return false;
    }

    if (isStructuralTableChange(tr)) {
        return true;
    }

    return transactionChangesOutsideCell(tr, activeCell);
}

function transactionChangesOutsideCell(tr: Transaction, activeCell: ResolvedActiveCell): boolean {
    let outsideCell = false;
    tr.changes.iterChanges((fromA, toA) => {
        if (outsideCell) {
            return;
        }
        if (fromA < activeCell.editableFrom || toA > activeCell.editableTo) {
            outsideCell = true;
        }
    });
    return outsideCell;
}

export function mapSelectionRange(range: SelectionRange, changeSet: ChangeSet): SelectionRange {
    return EditorSelection.range(changeSet.mapPos(range.anchor, 1), changeSet.mapPos(range.head, 1));
}

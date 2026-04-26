import type { EditorView } from '@codemirror/view';
import type { ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import {
    clearColumn,
    clearRow,
    clearTable,
    deleteColumn,
    deleteRow,
    deleteTable,
    insertColumnLeft,
    insertColumnRight,
    insertRowAbove,
    insertRowBelow,
    moveColumnLeft,
    moveColumnRight,
    moveRowDown,
    moveRowUp,
    updateAlignment,
} from './structuralOperations';

export type StructuralActionId =
    | 'insertRowBefore'
    | 'insertRowAfter'
    | 'deleteRow'
    | 'insertColumnBefore'
    | 'insertColumnAfter'
    | 'deleteColumn'
    | 'deleteTable'
    | 'moveRowUp'
    | 'moveRowDown'
    | 'moveColumnLeft'
    | 'moveColumnRight'
    | 'clearRow'
    | 'clearColumn'
    | 'clearTable'
    | 'alignLeft'
    | 'alignCenter'
    | 'alignRight';

type StructuralActionHandler = (view: EditorView, resolvedCell: ResolvedActiveCell) => boolean;

export const structuralActions: Record<StructuralActionId, StructuralActionHandler> = {
    insertRowBefore: insertRowAbove,
    insertRowAfter: insertRowBelow,
    deleteRow,
    insertColumnBefore: insertColumnLeft,
    insertColumnAfter: insertColumnRight,
    deleteColumn,
    deleteTable,
    moveRowUp,
    moveRowDown,
    moveColumnLeft,
    moveColumnRight,
    clearRow,
    clearColumn,
    clearTable,
    alignLeft: (view, resolvedCell) => updateAlignment(view, resolvedCell, 'left'),
    alignCenter: (view, resolvedCell) => updateAlignment(view, resolvedCell, 'center'),
    alignRight: (view, resolvedCell) => updateAlignment(view, resolvedCell, 'right'),
};

export function runStructuralAction(
    view: EditorView,
    actionId: StructuralActionId,
    resolvedCell: ResolvedActiveCell
): boolean {
    return structuralActions[actionId](view, resolvedCell);
}

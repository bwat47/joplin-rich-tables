import type { EditorView } from '@codemirror/view';
import type { TableAlignment } from '../../tableModel/MarkdownTable';
import type { StructuralTableCommandById, StructuralTableCommandId } from '../../tableModel/structuralCommandSemantics';
import type { ResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { runStructuralCommand } from './runStructuralCommand';

type AlignmentStructuralActionId = 'alignLeft' | 'alignCenter' | 'alignRight';

export type StructuralActionId = StructuralTableCommandId | AlignmentStructuralActionId;

const modelBackedCommands = {
    insertRowBefore: { type: 'insertRowBefore' },
    insertRowAfter: { type: 'insertRowAfter' },
    insertColumnBefore: { type: 'insertColumnBefore' },
    insertColumnAfter: { type: 'insertColumnAfter' },
    deleteRow: { type: 'deleteRow' },
    deleteColumn: { type: 'deleteColumn' },
    moveRowUp: { type: 'moveRowUp' },
    moveRowDown: { type: 'moveRowDown' },
    moveColumnLeft: { type: 'moveColumnLeft' },
    moveColumnRight: { type: 'moveColumnRight' },
    clearRow: { type: 'clearRow' },
    clearColumn: { type: 'clearColumn' },
    clearTable: { type: 'clearTable' },
    deleteTable: { type: 'deleteTable' },
    sortColumnAscending: { type: 'sortColumnAscending' },
    sortColumnDescending: { type: 'sortColumnDescending' },
} satisfies StructuralTableCommandById;

const alignmentCommands = {
    alignLeft: 'left',
    alignCenter: 'center',
    alignRight: 'right',
} satisfies Record<AlignmentStructuralActionId, TableAlignment>;

function isModelBackedAction(actionId: StructuralActionId): actionId is StructuralTableCommandId {
    return Object.prototype.hasOwnProperty.call(modelBackedCommands, actionId);
}

function isAlignmentAction(actionId: StructuralActionId): actionId is AlignmentStructuralActionId {
    return Object.prototype.hasOwnProperty.call(alignmentCommands, actionId);
}

function assertNeverAction(actionId: never): never {
    throw new Error(`Unhandled structural action: ${actionId}`);
}

export function runStructuralAction(
    view: EditorView,
    actionId: StructuralActionId,
    resolvedCell: ResolvedActiveCell
): boolean {
    if (isModelBackedAction(actionId)) {
        return runStructuralCommand(view, resolvedCell, modelBackedCommands[actionId]);
    }

    if (isAlignmentAction(actionId)) {
        return runStructuralCommand(view, resolvedCell, {
            type: 'alignColumn',
            alignment: alignmentCommands[actionId],
        });
    }

    return assertNeverAction(actionId);
}

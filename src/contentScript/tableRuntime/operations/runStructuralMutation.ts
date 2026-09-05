import { EditorView } from '@codemirror/view';
import { clearActiveCellEffect, type ActiveCell } from '../../tableState/activeCellState';
import { rebuildTableWidgetsEffect } from '../../tableState/tableWidgetEffects';
import { applyStructuralTableCommand, type StructuralTableCommand } from '../../tableModel/structuralCommandSemantics';
import { prepareOpenCellRequestAttachment } from '../openCellRequest';
import { createActiveCellForTable } from '../activeCell/activeCellFactory';
import type { InitialCursorPos } from '../../shared/cursorPlacement';
import type { ResolvedActiveCell } from '../activeCell/resolvedActiveCell';

function isSameCellCoords(a: ActiveCell, b: ActiveCell): boolean {
    return a.section === b.section && a.row === b.row && a.col === b.col;
}

export interface StructuralReopenOptions {
    initialCursorPos?: InitialCursorPos;
    afterDispatch?: () => void;
    clearCellSelection?: boolean;
    suppressKeys?: boolean;
}

export interface RunStructuralMutationAndReopenParams extends StructuralReopenOptions {
    view: EditorView;
    resolvedCell: ResolvedActiveCell;
    command: StructuralTableCommand;
}

interface PreparedTableMutation {
    kind: 'table';
    tableFrom: number;
    tableTo: number;
    newText: string;
    hasDocumentChange: boolean;
    nextActiveCell: NonNullable<ReturnType<typeof createActiveCellForTable>>;
}

interface PreparedTableDeletion {
    kind: 'deleteTable';
    tableFrom: number;
    tableTo: number;
}

type PreparedStructuralMutation = PreparedTableMutation | PreparedTableDeletion;

function prepareStructuralMutation(params: RunStructuralMutationAndReopenParams): PreparedStructuralMutation | null {
    const { resolvedCell } = params;
    const cell = resolvedCell.activeCell;
    const { tableFrom, tableTo, ctx } = resolvedCell;
    const text = ctx.text;

    const mutationResult = applyStructuralTableCommand(ctx.table, cell, params.command);
    if (mutationResult.kind === 'deleteTable') {
        return {
            kind: 'deleteTable',
            tableFrom,
            tableTo,
        };
    }

    const newTableData = mutationResult.table;
    if (newTableData === ctx.table) {
        return null;
    }
    const serialized = newTableData.serializeWithOffsets();

    const nextActiveCell = createActiveCellForTable({
        tableFrom,
        serialized,
        target: mutationResult.targetCell,
    });
    if (!nextActiveCell) {
        return null;
    }
    const hasDocumentChange = serialized.text !== text;
    if (!hasDocumentChange && isSameCellCoords(nextActiveCell.activeCell, cell)) {
        return null;
    }

    return {
        kind: 'table',
        tableFrom,
        tableTo,
        newText: serialized.text,
        hasDocumentChange,
        nextActiveCell,
    };
}

export function runStructuralMutationAndReopen(params: RunStructuralMutationAndReopenParams): boolean {
    const prepared = prepareStructuralMutation(params);
    if (!prepared) {
        return false;
    }

    if (prepared.kind === 'deleteTable') {
        params.view.dispatch({
            changes: { from: prepared.tableFrom, to: prepared.tableTo, insert: '' },
            effects: [clearActiveCellEffect.of(undefined), rebuildTableWidgetsEffect.of(undefined)],
        });
        params.afterDispatch?.();

        return true;
    }

    const openRequest = prepareOpenCellRequestAttachment({
        activeCell: prepared.nextActiveCell.activeCell,
        selectionAnchor: prepared.nextActiveCell.selectionAnchor,
        initialCursorPos: params.initialCursorPos,
        clearCellSelection: params.clearCellSelection,
        suppressKeys: params.suppressKeys,
    });

    params.view.dispatch({
        ...(prepared.hasDocumentChange
            ? {
                  changes: {
                      from: prepared.tableFrom,
                      to: prepared.tableTo,
                      insert: prepared.newText,
                  },
              }
            : {}),
        ...openRequest,
        effects: [...openRequest.effects, rebuildTableWidgetsEffect.of(undefined)],
    });
    params.afterDispatch?.();

    return true;
}

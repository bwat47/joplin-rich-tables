import { EditorView } from '@codemirror/view';
import { clearActiveCellEffect, type ActiveCell } from '../../tableState/activeCellState';
import { rebuildTableWidgetsEffect } from '../../tableState/tableWidgetEffects';
import { applyStructuralTableCommand, type StructuralTableCommand } from '../../tableModel/structuralCommandSemantics';
import { prepareOpenCellRequestTransaction } from '../openCellRequest';
import { createActiveCellForTableText } from '../activeCell/activeCellFactory';
import type { ResolvedActiveCell } from '../activeCell/resolvedActiveCell';

function isSameCellCoords(a: ActiveCell, b: ActiveCell): boolean {
    return a.section === b.section && a.row === b.row && a.col === b.col;
}

export interface StructuralReopenOptions {
    initialCursorPos?: 'start' | 'end' | 'lastLineStart';
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
    nextActiveCell: NonNullable<ReturnType<typeof createActiveCellForTableText>>;
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
    const newText = newTableData.serialize();

    const nextActiveCell = createActiveCellForTableText({
        tableFrom,
        tableText: newText,
        target: mutationResult.targetCell,
    });
    if (!nextActiveCell) {
        return null;
    }
    const hasDocumentChange = newText !== text;
    if (!hasDocumentChange && isSameCellCoords(nextActiveCell.activeCell, cell)) {
        return null;
    }

    return {
        kind: 'table',
        tableFrom,
        tableTo,
        newText,
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
            effects: [
                clearActiveCellEffect.of(undefined),
                rebuildTableWidgetsEffect.of({ tableFrom: prepared.tableFrom }),
            ],
        });
        params.afterDispatch?.();

        return true;
    }

    const openTransaction = prepareOpenCellRequestTransaction({
        target: {
            activeCell: prepared.nextActiveCell.activeCell,
            selectionAnchor: prepared.nextActiveCell.selectionAnchor,
        },
        normalizeIfNeeded: false,
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
        ...openTransaction,
        effects: [...openTransaction.effects, rebuildTableWidgetsEffect.of({ tableFrom: prepared.tableFrom })],
    });
    params.afterDispatch?.();

    return true;
}

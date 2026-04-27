import { EditorView } from '@codemirror/view';
import { type ActiveCell } from '../../tableState/activeCellState';
import { rebuildTableWidgetsEffect } from '../../tableState/tableWidgetEffects';
import { MarkdownTable } from '../../tableModel/MarkdownTable';
import type { TargetCell } from '../../tableModel/activeCellForTableText';
import type { StructuralTableCommandResult } from '../../tableModel/structuralCommandSemantics';
import { prepareOpenCellRequestTransaction } from '../openCellRequest';
import { createActiveCellForTableText } from '../activeCell/activeCellFactory';
import type { ResolvedActiveCell } from '../activeCell/resolvedActiveCell';

function isSameCellCoords(a: ActiveCell, b: ActiveCell): boolean {
    return a.section === b.section && a.row === b.row && a.col === b.col;
}

interface StructuralMutationCallbackParams {
    view: EditorView;
    resolvedCell: ResolvedActiveCell;
    operation: (table: MarkdownTable, cell: ActiveCell) => MarkdownTable;
    computeTargetCell: (cell: ActiveCell, oldTable: MarkdownTable, newTable: MarkdownTable) => TargetCell;
}

interface PreparedStructuralMutationParams {
    view: EditorView;
    resolvedCell: ResolvedActiveCell;
    prepareMutation: (table: MarkdownTable, cell: ActiveCell) => StructuralTableCommandResult;
}

type StructuralMutationPreparationParams = StructuralMutationCallbackParams | PreparedStructuralMutationParams;

export interface StructuralReopenOptions {
    initialCursorPos?: 'start' | 'end' | 'lastLineStart';
    afterDispatch?: () => void;
    clearCellSelection?: boolean;
    suppressKeys?: boolean;
}

export type RunStructuralMutationAndReopenParams = StructuralMutationPreparationParams & StructuralReopenOptions;

interface PreparedStructuralMutation {
    tableFrom: number;
    tableTo: number;
    newText: string;
    hasDocumentChange: boolean;
    nextActiveCell: NonNullable<ReturnType<typeof createActiveCellForTableText>>;
}

function prepareStructuralMutation(params: StructuralMutationPreparationParams): PreparedStructuralMutation | null {
    const { resolvedCell } = params;
    const cell = resolvedCell.activeCell;
    const { tableFrom, tableTo, ctx } = resolvedCell;
    const text = ctx.text;

    const mutationResult = (() => {
        if ('prepareMutation' in params) {
            return params.prepareMutation(ctx.table, cell);
        }

        const table = params.operation(ctx.table, cell);
        return {
            table,
            targetCell: params.computeTargetCell(cell, ctx.table, table),
        };
    })();
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

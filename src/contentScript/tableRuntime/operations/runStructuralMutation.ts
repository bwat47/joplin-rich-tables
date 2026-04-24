import { EditorView } from '@codemirror/view';
import type { StateEffect } from '@codemirror/state';
import { setActiveCellEffect, type ActiveCell } from '../../tableState/activeCellState';
import { rebuildTableWidgetsEffect } from '../../tableState/tableWidgetEffects';
import { MarkdownTable } from '../../tableModel/MarkdownTable';
import type { TargetCell } from '../../tableModel/activeCellForTableText';
import { prepareOpenCellRequestTransaction } from '../openCellRequest';
import { createActiveCellForTableText } from '../activeCell/activeCellFactory';
import { resolveActiveCell } from '../activeCell/resolvedActiveCell';

function isSameCellCoords(a: ActiveCell, b: ActiveCell): boolean {
    return a.section === b.section && a.row === b.row && a.col === b.col;
}

export interface RunStructuralMutationParams {
    view: EditorView;
    cell: ActiveCell;
    operation: (table: MarkdownTable, cell: ActiveCell) => MarkdownTable;
    computeTargetCell: (cell: ActiveCell, oldTable: MarkdownTable, newTable: MarkdownTable) => TargetCell;
    forceWidgetRebuild: boolean;
}

export interface StructuralReopenOptions {
    initialCursorPos?: 'start' | 'end' | 'lastLineStart';
    afterDispatch?: () => void;
    clearCellSelection?: boolean;
    suppressKeys?: boolean;
}

export interface RunStructuralMutationAndReopenParams
    extends Omit<RunStructuralMutationParams, 'forceWidgetRebuild'>, StructuralReopenOptions {}

interface PreparedStructuralMutation {
    tableFrom: number;
    tableTo: number;
    newText: string;
    hasDocumentChange: boolean;
    nextActiveCell: NonNullable<ReturnType<typeof createActiveCellForTableText>>;
}

function prepareStructuralMutation(params: RunStructuralMutationParams): PreparedStructuralMutation | null {
    const { view, cell, operation, computeTargetCell } = params;
    const resolvedCell = resolveActiveCell(view.state, cell);
    if (!resolvedCell) return null;

    const { tableFrom, tableTo, ctx } = resolvedCell;
    const text = ctx.text;

    const newTableData = operation(ctx.table, cell);
    if (newTableData === ctx.table) {
        return null;
    }
    const newText = newTableData.serialize();

    const target = computeTargetCell(cell, ctx.table, newTableData);
    const nextActiveCell = createActiveCellForTableText({ tableFrom, tableText: newText, target });
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

export function runStructuralMutation(params: RunStructuralMutationParams): boolean {
    const prepared = prepareStructuralMutation(params);
    if (!prepared) {
        return false;
    }

    const effects: StateEffect<unknown>[] = [setActiveCellEffect.of(prepared.nextActiveCell.activeCell)];
    if (params.forceWidgetRebuild) {
        effects.push(rebuildTableWidgetsEffect.of({ tableFrom: prepared.tableFrom }));
    }

    if (prepared.hasDocumentChange) {
        params.view.dispatch({
            changes: {
                from: prepared.tableFrom,
                to: prepared.tableTo,
                insert: prepared.newText,
            },
            effects,
        });
    } else {
        params.view.dispatch({ effects });
    }

    return true;
}

export function runStructuralMutationAndReopen(params: RunStructuralMutationAndReopenParams): boolean {
    const prepared = prepareStructuralMutation({
        ...params,
        forceWidgetRebuild: true,
    });
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

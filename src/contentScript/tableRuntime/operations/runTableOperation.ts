import { EditorView } from '@codemirror/view';
import type { StateEffect } from '@codemirror/state';
import { setActiveCellEffect, type ActiveCell } from '../../tableState/activeCellState';
import { rebuildTableWidgetsEffect } from '../../tableState/tableWidgetEffects';
import { MarkdownTable } from '../../tableModel/MarkdownTable';
import type { TargetCell } from '../../tableModel/activeCellForTableText';
import { prepareOpenActiveCellTransaction } from '../activeCell/activeCellOpen';
import { createActiveCellForTableText } from '../activeCell/activeCellFactory';
import { resolveActiveCell } from '../activeCell/activeCellResolver';

function isSameCellCoords(a: ActiveCell, b: ActiveCell): boolean {
    return a.section === b.section && a.row === b.row && a.col === b.col;
}

export interface ModifyTableParams {
    view: EditorView;
    cell: ActiveCell;
    operation: (table: MarkdownTable, cell: ActiveCell) => MarkdownTable;
    computeTargetCell: (cell: ActiveCell, oldTable: MarkdownTable, newTable: MarkdownTable) => TargetCell;
    forceWidgetRebuild: boolean;
}

export interface ModifyTableAndOpenParams extends Omit<ModifyTableParams, 'forceWidgetRebuild'> {
    initialCursorPos?: 'start' | 'end' | 'lastLineStart';
    onFocused?: () => void;
    clearCellSelection?: boolean;
}

interface PreparedTableOperation {
    tableFrom: number;
    tableTo: number;
    newText: string;
    hasDocumentChange: boolean;
    nextActiveCell: NonNullable<ReturnType<typeof createActiveCellForTableText>>;
}

function prepareTableOperation(params: ModifyTableParams): PreparedTableOperation | null {
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

export function runTableOperation(params: ModifyTableParams): boolean {
    const prepared = prepareTableOperation(params);
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

export function runTableOperationAndOpen(params: ModifyTableAndOpenParams): boolean {
    const prepared = prepareTableOperation({
        ...params,
        forceWidgetRebuild: true,
    });
    if (!prepared) {
        return false;
    }

    const openTransaction = prepareOpenActiveCellTransaction(params.view, {
        activeCell: prepared.nextActiveCell.activeCell,
        selectionAnchor: prepared.nextActiveCell.selectionAnchor,
        normalizeIfNeeded: false,
        initialCursorPos: params.initialCursorPos,
        onFocused: params.onFocused,
        clearCellSelection: params.clearCellSelection,
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

    return true;
}

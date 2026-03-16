import { EditorView } from '@codemirror/view';
import type { StateEffect } from '@codemirror/state';
import { setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import type { TargetCell } from '../tableModel/activeCellForTableText';
import { createActiveCellForTableText } from './activeCellFactory';
import { resolveActiveCell } from './activeCellResolver';

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

export function runTableOperation(params: ModifyTableParams): boolean {
    const { view, cell, operation, computeTargetCell, forceWidgetRebuild } = params;
    const resolvedCell = resolveActiveCell(view.state, cell);
    if (!resolvedCell) return false;

    const { tableFrom, tableTo, ctx } = resolvedCell;
    const text = ctx.text;

    const newTableData = operation(ctx.table, cell);
    if (newTableData === ctx.table) {
        return false;
    }
    const newText = newTableData.serialize();

    const target = computeTargetCell(cell, ctx.table, newTableData);
    const nextActiveCell = createActiveCellForTableText({ tableFrom, tableText: newText, target });
    if (!nextActiveCell) {
        return false;
    }
    const hasDocumentChange = newText !== text;
    if (!hasDocumentChange && isSameCellCoords(nextActiveCell, cell)) {
        return false;
    }

    const effects: StateEffect<unknown>[] = [setActiveCellEffect.of(nextActiveCell)];
    if (forceWidgetRebuild) {
        effects.push(rebuildTableWidgetsEffect.of({ tableFrom }));
    }

    if (hasDocumentChange) {
        view.dispatch({
            changes: {
                from: tableFrom,
                to: tableTo,
                insert: newText,
            },
            effects,
        });
    } else {
        view.dispatch({ effects });
    }

    return true;
}

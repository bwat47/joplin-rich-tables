import { EditorView } from '@codemirror/view';
import type { StateEffect } from '@codemirror/state';
import { ActiveCell, setActiveCellEffect } from '../tableWidget/activeCellState';
import { MarkdownTable } from './MarkdownTable';
import { rebuildTableWidgetsEffect } from '../tableWidget/tableWidgetEffects';
import { computeActiveCellForTableText, type TargetCell } from './activeCellForTableText';

interface ModifyTableParams {
    view: EditorView;
    cell: ActiveCell;
    operation: (table: MarkdownTable, cell: ActiveCell) => MarkdownTable;
    computeTargetCell: (cell: ActiveCell, oldTable: MarkdownTable, newTable: MarkdownTable) => TargetCell;
    forceWidgetRebuild: boolean;
    serializeIfIdentity?: boolean;
}

export function runTableOperation(params: ModifyTableParams): boolean {
    const { view, cell, operation, computeTargetCell, forceWidgetRebuild, serializeIfIdentity = false } = params;
    const { tableFrom, tableTo } = cell;

    const text = view.state.sliceDoc(tableFrom, tableTo);
    const tableData = MarkdownTable.parse(text);

    if (!tableData) return false;

    const newTableData = operation(tableData, cell);
    if (newTableData === tableData && !serializeIfIdentity) {
        return false;
    }
    const newText = newTableData.serialize();
    if (newText === text) {
        return false;
    }

    const target = computeTargetCell(cell, tableData, newTableData);
    const nextActiveCell = computeActiveCellForTableText({ tableFrom, tableText: newText, target });
    if (!nextActiveCell) {
        return false;
    }

    const effects: StateEffect<unknown>[] = [setActiveCellEffect.of(nextActiveCell)];
    if (forceWidgetRebuild) {
        effects.push(rebuildTableWidgetsEffect.of({ tableFrom }));
    }

    view.dispatch({
        changes: {
            from: tableFrom,
            to: tableTo,
            insert: newText,
        },
        effects,
    });

    return true;
}

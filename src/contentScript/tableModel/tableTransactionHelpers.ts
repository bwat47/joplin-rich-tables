import { EditorView } from '@codemirror/view';
import type { StateEffect } from '@codemirror/state';
import { ActiveCell, setActiveCellEffect } from '../tableWidget/activeCellState';
import { parseMarkdownTable, TableData } from './markdownTableParsing';
import { serializeTable } from './markdownTableManipulation';
import { rebuildTableWidgetsEffect } from '../tableWidget/tableWidgetEffects';
import { computeActiveCellForTableText, type TargetCell } from '../toolbar/tableToolbarActiveCell';

interface ModifyTableParams {
    view: EditorView;
    cell: ActiveCell;
    operation: (table: TableData, cell: ActiveCell) => TableData;
    computeTargetCell: (cell: ActiveCell, oldTable: TableData, newTable: TableData) => TargetCell;
    forceWidgetRebuild: boolean;
}

export function runTableOperation(params: ModifyTableParams): void {
    const { view, cell, operation, computeTargetCell, forceWidgetRebuild } = params;
    const { tableFrom, tableTo } = cell;

    const text = view.state.sliceDoc(tableFrom, tableTo);
    const tableData = parseMarkdownTable(text);

    if (!tableData) return;

    const newTableData = operation(tableData, cell);
    if (newTableData === tableData) {
        return;
    }
    const newText = serializeTable(newTableData);

    const target = computeTargetCell(cell, tableData, newTableData);
    const nextActiveCell = computeActiveCellForTableText({ tableFrom, tableText: newText, target });
    if (!nextActiveCell) {
        return;
    }

    const effects: StateEffect<unknown>[] = [setActiveCellEffect.of(nextActiveCell)];
    if (forceWidgetRebuild) {
        effects.push(rebuildTableWidgetsEffect.of(undefined));
    }

    view.dispatch({
        changes: {
            from: tableFrom,
            to: tableTo,
            insert: newText,
        },
        effects,
    });
}

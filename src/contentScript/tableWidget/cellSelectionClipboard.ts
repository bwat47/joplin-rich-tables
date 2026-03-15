import { EditorView } from '@codemirror/view';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { getCellRange } from '../tableModel/markdownTableCellRanges';
import { resolveTableContextAtPos } from './tablePositioning';
import { fromUnifiedRow, getCellSelection, toSelectionRect, type CellSelection } from './cellSelectionState';

export function extractSelectedCellContents(state: Parameters<typeof getCellSelection>[0], selection: CellSelection): string[][] {
    const ctx = resolveTableContextAtPos(state, selection.tableFrom);
    if (!ctx) {
        return [];
    }

    const rect = toSelectionRect(selection);
    const rows: string[][] = [];

    for (let unifiedRow = rect.minRow; unifiedRow <= rect.maxRow; unifiedRow++) {
        const currentRow: string[] = [];

        for (let col = rect.minCol; col <= rect.maxCol; col++) {
            const coords = fromUnifiedRow(unifiedRow, col);
            const range = getCellRange(ctx.cellRanges, coords);

            currentRow.push(range ? ctx.text.slice(range.from, range.to) : '');
        }

        rows.push(currentRow);
    }

    return rows;
}

export function copySelectionAsMarkdown(state: Parameters<typeof getCellSelection>[0], selection: CellSelection): string | null {
    const ctx = resolveTableContextAtPos(state, selection.tableFrom);
    if (!ctx) {
        return null;
    }

    const rows = extractSelectedCellContents(state, selection);
    if (rows.length === 0) {
        return null;
    }

    const rect = toSelectionRect(selection);
    const selectionIncludesHeader = rect.minRow === 0;
    const headerCells = rows[0];
    const bodyRows = rows.slice(1);
    const alignments = selectionIncludesHeader
        ? ctx.table.alignments.slice(rect.minCol, rect.maxCol + 1)
        : headerCells.map(() => null);

    return MarkdownTable.fromParts({
        headerCells,
        alignments,
        bodyRows,
    }).serialize();
}

export const cellSelectionClipboardHandlers = EditorView.domEventHandlers({
    copy: (event, view) => {
        const selection = getCellSelection(view.state);
        if (!selection) {
            return false;
        }

        const markdown = copySelectionAsMarkdown(view.state, selection);
        if (!markdown || !event.clipboardData) {
            return false;
        }

        event.clipboardData.setData('text/plain', markdown);
        event.preventDefault();
        return true;
    },
});

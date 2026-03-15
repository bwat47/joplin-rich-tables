import { EditorView, ViewPlugin } from '@codemirror/view';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { getCellRange } from '../tableModel/markdownTableCellRanges';
import { resolveTableContextAtPos } from './tablePositioning';
import { fromUnifiedRow, getCellSelection, toSelectionRect, type CellSelection } from './cellSelectionState';
import { canHandleTableSelectionShortcut } from './cellSelectionShortcutScope';

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

function handleSelectionCopy(event: ClipboardEvent, view: EditorView): boolean {
    const selection = getCellSelection(view.state);
    if (!selection || !event.clipboardData) {
        return false;
    }

    if (!canHandleTableSelectionShortcut(view)) {
        return false;
    }

    const markdown = copySelectionAsMarkdown(view.state, selection);
    if (!markdown) {
        return false;
    }

    event.clipboardData.setData('text/plain', markdown);
    event.preventDefault();
    return true;
}

export const cellSelectionClipboardPlugin = ViewPlugin.fromClass(
    class {
        private readonly onCopy: (event: ClipboardEvent) => void;

        constructor(private readonly view: EditorView) {
            this.onCopy = (event) => {
                handleSelectionCopy(event, this.view);
            };

            this.view.dom.ownerDocument.addEventListener('copy', this.onCopy, true);
        }

        destroy(): void {
            this.view.dom.ownerDocument.removeEventListener('copy', this.onCopy, true);
        }
    }
);

import { EditorSelection } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { ClipboardTableFragment, MarkdownTable, type TableAlignment } from '../../tableModel/MarkdownTable';
import { clearActiveCellEffect, getActiveCell } from '../../tableState/activeCellState';
import {
    cellSelectionTransitionAnnotation,
    clearCellSelectionEffect,
    fromUnifiedRow,
    getCellSelection,
    selectionFromRect,
    setCellSelectionEffect,
    toSelectionRect,
    type CellSelection,
} from '../../tableState/cellSelectionState';
import { createActiveCellForTableText } from '../activeCell/activeCellFactory';
import { resolveTableContextAtPos } from '../tablePositioning';
import { getCellRange } from '../../tableModel/markdownTableCellRanges';
import type { CellCoords } from '../../tableModel/types';
import { canHandleTableClipboardShortcut, canHandleTableSelectionKeydown } from './cellSelectionShortcutScope';
import { isNestedEditorOpen } from '../../nestedEditor/nestedEditorController';

export interface TableClipboardTarget {
    tableFrom: number;
    anchor: CellCoords;
    source: 'selection' | 'activeCell';
}

export interface TableClipboardRewrite {
    tableFrom: number;
    tableText: string;
    selection: CellSelection | null;
    clearActiveCell: boolean;
    selectionAnchorPos: number;
}

export function extractSelectedCellContents(
    state: Parameters<typeof getCellSelection>[0],
    selection: CellSelection
): string[][] {
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

export function copySelectionAsMarkdown(
    state: Parameters<typeof getCellSelection>[0],
    selection: CellSelection
): string | null {
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

export function parseMarkdownTableClipboard(text: string): ClipboardTableFragment | null {
    const table = MarkdownTable.parse(text);
    if (!table) {
        return null;
    }

    return {
        cells: [table.headerCells.slice(), ...table.bodyRows.map((row) => [...row])],
        alignments: table.alignments.slice() as TableAlignment[],
    };
}

export function resolveTableClipboardTarget(
    state: Parameters<typeof getCellSelection>[0],
    options: { nestedEditorOpen: boolean }
): TableClipboardTarget | null {
    const selection = getCellSelection(state);
    if (selection) {
        const rect = toSelectionRect(selection);
        return {
            tableFrom: selection.tableFrom,
            anchor: fromUnifiedRow(rect.minRow, rect.minCol),
            source: 'selection',
        };
    }

    if (!options.nestedEditorOpen) {
        return null;
    }

    const activeCell = getActiveCell(state);
    if (!activeCell) {
        return null;
    }

    return {
        tableFrom: activeCell.tableFrom,
        anchor: {
            section: activeCell.section,
            row: activeCell.row,
            col: activeCell.col,
        },
        source: 'activeCell',
    };
}

function computeSelectionAnchorPos(tableFrom: number, tableText: string, coords: CellCoords): number | null {
    const activeCell = createActiveCellForTableText({
        tableFrom,
        tableText,
        target: coords,
    });

    return activeCell?.selectionAnchor ?? null;
}

function buildTableRewrite(params: {
    tableFrom: number;
    tableText: string;
    selection: CellSelection | null;
    clearActiveCell: boolean;
}): TableClipboardRewrite | null {
    let selectionAnchorPos = params.tableFrom;
    if (params.selection) {
        const rect = toSelectionRect(params.selection);
        const topLeft = fromUnifiedRow(rect.minRow, rect.minCol);
        const nextSelectionAnchorPos = computeSelectionAnchorPos(params.tableFrom, params.tableText, topLeft);
        if (nextSelectionAnchorPos === null) {
            return null;
        }
        selectionAnchorPos = nextSelectionAnchorPos;
    }

    return {
        tableFrom: params.tableFrom,
        tableText: params.tableText,
        selection: params.selection,
        clearActiveCell: params.clearActiveCell,
        selectionAnchorPos,
    };
}

function clampIndex(value: number, max: number): number {
    return Math.max(0, Math.min(value, max));
}

function remapSelectionAfterRowDelete(
    tableFrom: number,
    rect: ReturnType<typeof toSelectionRect>,
    nextTable: MarkdownTable
) {
    const rowSpan = rect.maxRow - rect.minRow;
    const minRow = clampIndex(rect.minRow, nextTable.rowCount - 1);
    const maxRow = Math.max(minRow, clampIndex(rect.minRow + rowSpan, nextTable.rowCount - 1));

    return selectionFromRect(tableFrom, {
        minRow,
        maxRow,
        minCol: 0,
        maxCol: nextTable.columnCount - 1,
    });
}

function remapSelectionAfterColumnDelete(
    tableFrom: number,
    rect: ReturnType<typeof toSelectionRect>,
    nextTable: MarkdownTable
) {
    const colSpan = rect.maxCol - rect.minCol;
    const minCol = clampIndex(rect.minCol, nextTable.columnCount - 1);
    const maxCol = Math.max(minCol, clampIndex(rect.minCol + colSpan, nextTable.columnCount - 1));

    return selectionFromRect(tableFrom, {
        minRow: 0,
        maxRow: nextTable.rowCount - 1,
        minCol,
        maxCol,
    });
}

export function buildSelectionRemovalRewrite(
    state: Parameters<typeof getCellSelection>[0],
    selection: CellSelection
): TableClipboardRewrite | null {
    const ctx = resolveTableContextAtPos(state, selection.tableFrom);
    if (!ctx) {
        return null;
    }

    const rect = toSelectionRect(selection);
    const isEmptySelection = ctx.table.isRectEmpty(rect);
    const spansAllRows = rect.minRow === 0 && rect.maxRow === ctx.table.rowCount - 1;
    const spansAllCols = rect.minCol === 0 && rect.maxCol === ctx.table.columnCount - 1;

    if (isEmptySelection && spansAllRows && spansAllCols) {
        return {
            tableFrom: ctx.from,
            tableText: '',
            selection: null,
            clearActiveCell: true,
            selectionAnchorPos: ctx.from,
        };
    }

    if (isEmptySelection && spansAllCols) {
        const nextTable = ctx.table.deleteUnifiedRowRange(rect.minRow, rect.maxRow);
        if (nextTable !== ctx.table) {
            return buildTableRewrite({
                tableFrom: ctx.from,
                tableText: nextTable.serialize(),
                selection: remapSelectionAfterRowDelete(ctx.from, rect, nextTable),
                clearActiveCell: false,
            });
        }
    }

    if (isEmptySelection && spansAllRows) {
        const nextTable = ctx.table.deleteColumnRange(rect.minCol, rect.maxCol);
        if (nextTable !== ctx.table) {
            return buildTableRewrite({
                tableFrom: ctx.from,
                tableText: nextTable.serialize(),
                selection: remapSelectionAfterColumnDelete(ctx.from, rect, nextTable),
                clearActiveCell: false,
            });
        }
    }

    const nextTable = ctx.table.clearRect(rect);
    return buildTableRewrite({
        tableFrom: ctx.from,
        tableText: nextTable.serialize(),
        selection: selectionFromRect(ctx.from, rect),
        clearActiveCell: false,
    });
}

export function buildSelectionCutRewrite(
    state: Parameters<typeof getCellSelection>[0],
    selection: CellSelection
): TableClipboardRewrite | null {
    return buildSelectionRemovalRewrite(state, selection);
}

export function buildMultiCellPasteRewrite(
    state: Parameters<typeof getCellSelection>[0],
    target: TableClipboardTarget,
    clipboardText: string
): TableClipboardRewrite | null {
    const ctx = resolveTableContextAtPos(state, target.tableFrom);
    if (!ctx) {
        return null;
    }

    const fragment = parseMarkdownTableClipboard(clipboardText);
    if (!fragment) {
        return null;
    }

    const result = ctx.table.pasteFragmentAt(target.anchor, fragment);
    if (!result) {
        return null;
    }

    const nextSelection = selectionFromRect(ctx.from, result.pastedRect);
    const topLeft = fromUnifiedRow(result.pastedRect.minRow, result.pastedRect.minCol);
    const tableText = result.table.serialize();
    const selectionAnchorPos = computeSelectionAnchorPos(ctx.from, tableText, topLeft);
    if (selectionAnchorPos === null) {
        return null;
    }

    return {
        tableFrom: ctx.from,
        tableText,
        selection: nextSelection,
        clearActiveCell: target.source === 'activeCell',
        selectionAnchorPos,
    };
}

export function createTableClipboardRewriteSpec(
    state: Parameters<typeof getCellSelection>[0],
    rewrite: TableClipboardRewrite
) {
    const currentTable = resolveTableContextAtPos(state, rewrite.tableFrom);
    const effects = [
        ...(rewrite.selection
            ? [setCellSelectionEffect.of(rewrite.selection)]
            : [clearCellSelectionEffect.of(undefined)]),
        ...(rewrite.clearActiveCell ? [clearActiveCellEffect.of(undefined)] : []),
    ];

    return {
        ...(rewrite.tableText !== (currentTable?.text ?? '')
            ? {
                  changes: {
                      from: rewrite.tableFrom,
                      to: currentTable?.to ?? rewrite.tableFrom,
                      insert: rewrite.tableText,
                  },
              }
            : {}),
        selection: EditorSelection.single(rewrite.selectionAnchorPos),
        effects,
        annotations: cellSelectionTransitionAnnotation.of(true),
        scrollIntoView: false,
    };
}

function dispatchTableClipboardRewrite(view: EditorView, rewrite: TableClipboardRewrite): void {
    const currentSelection = getCellSelection(view.state);
    view.dispatch(createTableClipboardRewriteSpec(view.state, rewrite));

    if (!currentSelection || rewrite.selection === null) {
        view.focus();
    }
}

export function handleSelectionDelete(view: EditorView): boolean {
    const selection = getCellSelection(view.state);
    if (!selection) {
        return false;
    }

    if (!canHandleTableSelectionKeydown(view)) {
        return false;
    }

    const rewrite = buildSelectionRemovalRewrite(view.state, selection);
    if (!rewrite) {
        return false;
    }

    dispatchTableClipboardRewrite(view, rewrite);
    return true;
}

function handleSelectionCopy(event: ClipboardEvent, view: EditorView): boolean {
    const selection = getCellSelection(view.state);
    if (!selection || !event.clipboardData) {
        return false;
    }

    if (!canHandleTableSelectionKeydown(view)) {
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

function handleSelectionCut(event: ClipboardEvent, view: EditorView): boolean {
    const selection = getCellSelection(view.state);
    if (!selection || !event.clipboardData) {
        return false;
    }

    if (!canHandleTableSelectionKeydown(view)) {
        return false;
    }

    const markdown = copySelectionAsMarkdown(view.state, selection);
    if (!markdown) {
        return false;
    }

    const rewrite = buildSelectionCutRewrite(view.state, selection);
    if (!rewrite) {
        return false;
    }

    event.clipboardData.setData('text/plain', markdown);
    dispatchTableClipboardRewrite(view, rewrite);
    event.preventDefault();
    return true;
}

export function handleTableClipboardTextPaste(
    clipboardText: string,
    view: EditorView,
    options: { nestedEditorOpen: boolean }
): boolean {
    const target = resolveTableClipboardTarget(view.state, {
        nestedEditorOpen: options.nestedEditorOpen,
    });
    if (!target) {
        return false;
    }

    const rewrite = buildMultiCellPasteRewrite(view.state, target, clipboardText);
    if (!rewrite) {
        return false;
    }

    dispatchTableClipboardRewrite(view, rewrite);
    return true;
}

export function handleTableClipboardPaste(
    event: ClipboardEvent,
    view: EditorView,
    options: { nestedEditorOpen: boolean }
): boolean {
    if (!event.clipboardData) {
        return false;
    }

    if (!canHandleTableClipboardShortcut(view)) {
        return false;
    }

    const clipboardText = event.clipboardData.getData('text/plain');
    const handled = handleTableClipboardTextPaste(clipboardText, view, options);
    if (!handled) {
        const target = resolveTableClipboardTarget(view.state, {
            nestedEditorOpen: options.nestedEditorOpen,
        });
        if (target?.source === 'selection') {
            event.preventDefault();
            return true;
        }

        return false;
    }

    event.preventDefault();
    return true;
}

export const cellSelectionClipboardPlugin = ViewPlugin.fromClass(
    class {
        private readonly onCopy: (event: ClipboardEvent) => void;
        private readonly onCut: (event: ClipboardEvent) => void;
        private readonly onPaste: (event: ClipboardEvent) => void;

        constructor(private readonly view: EditorView) {
            this.onCopy = (event) => {
                handleSelectionCopy(event, this.view);
            };
            this.onCut = (event) => {
                handleSelectionCut(event, this.view);
            };
            this.onPaste = (event) => {
                handleTableClipboardPaste(event, this.view, {
                    nestedEditorOpen: isNestedEditorOpen(this.view),
                });
            };

            const doc = this.view.dom.ownerDocument;
            doc.addEventListener('copy', this.onCopy, true);
            doc.addEventListener('cut', this.onCut, true);
            doc.addEventListener('paste', this.onPaste, true);
        }

        destroy(): void {
            const doc = this.view.dom.ownerDocument;
            doc.removeEventListener('copy', this.onCopy, true);
            doc.removeEventListener('cut', this.onCut, true);
            doc.removeEventListener('paste', this.onPaste, true);
        }
    }
);

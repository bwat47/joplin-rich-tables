import { Annotation, EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import {
    ClipboardTableFragment,
    MarkdownTable,
    type SerializedTable,
    type TableAlignment,
} from '../../tableModel/MarkdownTable';
import { parseSingleTableBlock } from '../../tableModel/singleTableBlock';
import { clearActiveCellEffect } from '../../tableState/activeCellState';
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
import { createActiveCellForTable } from '../activeCell/activeCellFactory';
import { getResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { resolveTableContextAtPos } from '../tableResolution';
import { getCellRange } from '../../tableModel/markdownTableCellRanges';
import { tileFragmentToRect } from '../../tableModel/clipboardFragmentTiling';
import type { TableContext } from '../../tableModel/tableContext';
import type { CellCoords, TableRect } from '../../tableModel/types';
import { canHandleTableClipboardShortcut, canHandleTableSelectionKeydown } from './cellSelectionShortcutScope';
import { isNestedEditorOpen } from '../../nestedEditor/nestedEditorController';
import { clamp } from '../../shared/numberUtils';
import { sanitizeLocalText } from '../../shared/cellTextNormalization';

/**
 * Marks a transaction as one of this module's own table rewrites. The main-editor guard
 * treats those as trusted: the rewrite replaces the whole table, which the guard would
 * otherwise reject for reaching outside the active cell while a nested editor is open.
 */
export const tableClipboardRewriteAnnotation = Annotation.define<boolean>();

/**
 * Where a clipboard operation lands. A selection carries its rectangle so a paste can
 * size itself to the selection; an active cell has only its anchor, and always pastes
 * from there.
 */
export type TableClipboardTarget =
    | {
          tableFrom: number;
          anchor: CellCoords;
          source: 'activeCell';
      }
    | {
          tableFrom: number;
          anchor: CellCoords;
          source: 'selection';
          rect: TableRect;
      };

export interface TableClipboardRewrite {
    tableFrom: number;
    tableText: string;
    selection: CellSelection | null;
    clearActiveCell: boolean;
    selectionAnchorPos: number;
}

export function extractSelectedCellContents(state: EditorState, selection: CellSelection): string[][] {
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

export function copySelectionAsMarkdown(state: EditorState, selection: CellSelection): string | null {
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

/**
 * Reads clipboard text as a table fragment, but only when it holds exactly one table.
 * Anything else falls back to the plain-text path so a multi-table clipboard is never
 * folded into one fragment.
 */
export function parseMarkdownTableClipboard(text: string): ClipboardTableFragment | null {
    const table = parseSingleTableBlock(text);
    if (!table) {
        return null;
    }

    return {
        cells: [table.headerCells.slice(), ...table.bodyRows.map((row) => [...row])],
        alignments: table.alignments.slice() as TableAlignment[],
    };
}

/**
 * The chords that make the browser emit a clipboard event, which is where a table
 * selection is serialized and rewritten.
 *
 * Shift is excluded from the modifier-letter chords: those are the platform's plain
 * copy/cut/paste, while Ctrl+Shift+C and friends belong to other handlers. A chord left
 * out here still pastes correctly — the clipboard event is handled on its own listener —
 * it just no longer stops the root editor from also seeing the keydown.
 */
export function isNativeClipboardShortcut(event: KeyboardEvent): boolean {
    if (event.altKey) {
        return false;
    }

    const isModShortcut =
        (event.ctrlKey || event.metaKey) && !event.shiftKey && ['c', 'v', 'x'].includes(event.key.toLowerCase());
    const isCtrlInsert = event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === 'Insert';
    const isShiftInsertOrDelete =
        event.shiftKey && !event.ctrlKey && !event.metaKey && (event.key === 'Insert' || event.key === 'Delete');

    return isModShortcut || isCtrlInsert || isShiftInsertOrDelete;
}

export function resolveTableClipboardTarget(
    state: EditorState,
    options: { nestedEditorOpen: boolean }
): TableClipboardTarget | null {
    // An open nested editor owns its own cell, even when a mouse drag left a selection behind
    // it. An active cell that no longer resolves owns nothing, so a selection still applies.
    const resolvedActiveCell = options.nestedEditorOpen ? getResolvedActiveCell(state) : null;
    if (resolvedActiveCell) {
        const activeCell = resolvedActiveCell.activeCell;
        return {
            tableFrom: resolvedActiveCell.tableFrom,
            anchor: {
                section: activeCell.section,
                row: activeCell.row,
                col: activeCell.col,
            },
            source: 'activeCell',
        };
    }

    const selection = getCellSelection(state);
    if (!selection) {
        return null;
    }

    const rect = toSelectionRect(selection);
    return {
        tableFrom: selection.tableFrom,
        anchor: fromUnifiedRow(rect.minRow, rect.minCol),
        source: 'selection',
        rect,
    };
}

function computeSelectionAnchorPos(tableFrom: number, serialized: SerializedTable, coords: CellCoords): number | null {
    const activeCell = createActiveCellForTable({
        tableFrom,
        serialized,
        target: coords,
    });

    return activeCell?.selectionAnchor ?? null;
}

function buildTableRewrite(params: {
    tableFrom: number;
    table: MarkdownTable;
    selection: CellSelection | null;
    clearActiveCell: boolean;
}): TableClipboardRewrite | null {
    const serialized = params.table.serializeWithOffsets();

    let selectionAnchorPos = params.tableFrom;
    if (params.selection) {
        const rect = toSelectionRect(params.selection);
        const topLeft = fromUnifiedRow(rect.minRow, rect.minCol);
        const nextSelectionAnchorPos = computeSelectionAnchorPos(params.tableFrom, serialized, topLeft);
        if (nextSelectionAnchorPos === null) {
            return null;
        }
        selectionAnchorPos = nextSelectionAnchorPos;
    }

    return {
        tableFrom: params.tableFrom,
        tableText: serialized.text,
        selection: params.selection,
        clearActiveCell: params.clearActiveCell,
        selectionAnchorPos,
    };
}

function buildTableDeletionRewrite(tableFrom: number): TableClipboardRewrite {
    return {
        tableFrom,
        tableText: '',
        selection: null,
        clearActiveCell: true,
        selectionAnchorPos: tableFrom,
    };
}

/**
 * Re-clamps one selection axis onto a grid that just shrank, keeping the original
 * span length where the surviving rows/columns still allow it.
 */
function clampSpan(min: number, max: number, axisLength: number): { min: number; max: number } {
    const lastIndex = axisLength - 1;
    const clampedMin = clamp(min, 0, lastIndex);

    return {
        min: clampedMin,
        max: Math.max(clampedMin, clamp(max, 0, lastIndex)),
    };
}

function remapSelectionAfterRowDelete(tableFrom: number, rect: TableRect, nextTable: MarkdownTable) {
    const rows = clampSpan(rect.minRow, rect.maxRow, nextTable.rowCount);

    return selectionFromRect(tableFrom, {
        minRow: rows.min,
        maxRow: rows.max,
        minCol: 0,
        maxCol: nextTable.columnCount - 1,
    });
}

function remapSelectionAfterColumnDelete(tableFrom: number, rect: TableRect, nextTable: MarkdownTable) {
    const cols = clampSpan(rect.minCol, rect.maxCol, nextTable.columnCount);

    return selectionFromRect(tableFrom, {
        minRow: 0,
        maxRow: nextTable.rowCount - 1,
        minCol: cols.min,
        maxCol: cols.max,
    });
}

/** Null when the table refuses the deletion, i.e. it would leave no rows behind. */
function buildEmptyRowRangeRemoval(ctx: TableContext, rect: TableRect): TableClipboardRewrite | null {
    const nextTable = ctx.table.deleteUnifiedRowRange(rect.minRow, rect.maxRow);
    if (nextTable === ctx.table) {
        return null;
    }

    return buildTableRewrite({
        tableFrom: ctx.from,
        table: nextTable,
        selection: remapSelectionAfterRowDelete(ctx.from, rect, nextTable),
        clearActiveCell: false,
    });
}

/** Null when the table refuses the deletion, i.e. it would leave no columns behind. */
function buildEmptyColumnRangeRemoval(ctx: TableContext, rect: TableRect): TableClipboardRewrite | null {
    const nextTable = ctx.table.deleteColumnRange(rect.minCol, rect.maxCol);
    if (nextTable === ctx.table) {
        return null;
    }

    return buildTableRewrite({
        tableFrom: ctx.from,
        table: nextTable,
        selection: remapSelectionAfterColumnDelete(ctx.from, rect, nextTable),
        clearActiveCell: false,
    });
}

/**
 * Structural removal for an already-empty rectangle: the whole table, whole rows, or
 * whole columns. Null when the rectangle is not aligned to a structural axis, or when
 * the deletion would empty the table out entirely.
 */
function buildEmptySelectionRemoval(ctx: TableContext, rect: TableRect): TableClipboardRewrite | null {
    const spansAllRows = rect.minRow === 0 && rect.maxRow === ctx.table.rowCount - 1;
    const spansAllCols = rect.minCol === 0 && rect.maxCol === ctx.table.columnCount - 1;

    if (spansAllRows && spansAllCols) {
        return buildTableDeletionRewrite(ctx.from);
    }

    if (spansAllCols) {
        return buildEmptyRowRangeRemoval(ctx, rect);
    }

    if (spansAllRows) {
        return buildEmptyColumnRangeRemoval(ctx, rect);
    }

    return null;
}

export function buildSelectionRemovalRewrite(
    state: EditorState,
    selection: CellSelection
): TableClipboardRewrite | null {
    const ctx = resolveTableContextAtPos(state, selection.tableFrom);
    if (!ctx) {
        return null;
    }

    const rect = toSelectionRect(selection);
    if (ctx.table.isRectEmpty(rect)) {
        const structuralRewrite = buildEmptySelectionRemoval(ctx, rect);
        if (structuralRewrite) {
            return structuralRewrite;
        }
    }

    // Rectangles that still hold text (or that no structural deletion accepted) are cleared in place.
    return buildTableRewrite({
        tableFrom: ctx.from,
        table: ctx.table.clearRect(rect),
        selection: selectionFromRect(ctx.from, rect),
        clearActiveCell: false,
    });
}

/**
 * Turns clipboard text that is not a table into the single cell it represents, so a
 * selection can be filled with it. Only a cell selection asks for this: an active cell
 * owns its own paste, and returning null there leaves the text to the nested editor's
 * ordinary insertion.
 */
function createPlainTextFragment(clipboardText: string, target: TableClipboardTarget): ClipboardTableFragment | null {
    if (target.source !== 'selection') {
        return null;
    }

    if (clipboardText.trim().length === 0) {
        return null;
    }

    return {
        cells: [[sanitizeLocalText(clipboardText)]],
        alignments: [null],
    };
}

export function buildMultiCellPasteRewrite(
    state: EditorState,
    target: TableClipboardTarget,
    clipboardText: string
): TableClipboardRewrite | null {
    const ctx = resolveTableContextAtPos(state, target.tableFrom);
    if (!ctx) {
        return null;
    }

    const fragment = parseMarkdownTableClipboard(clipboardText) ?? createPlainTextFragment(clipboardText, target);
    if (!fragment) {
        return null;
    }

    // Tile whole fragment repetitions from the selection's top-left. Any trailing partial
    // repetition stays untouched, while a fragment larger than the selection still pastes once.
    const placedFragment = target.source === 'selection' ? tileFragmentToRect(fragment, target.rect) : fragment;

    const result = ctx.table.pasteFragmentAt(target.anchor, placedFragment);
    if (!result) {
        return null;
    }

    const nextSelection = selectionFromRect(ctx.from, result.pastedRect);
    const topLeft = fromUnifiedRow(result.pastedRect.minRow, result.pastedRect.minCol);
    const serialized = result.table.serializeWithOffsets();
    const selectionAnchorPos = computeSelectionAnchorPos(ctx.from, serialized, topLeft);
    if (selectionAnchorPos === null) {
        return null;
    }

    return {
        tableFrom: ctx.from,
        tableText: serialized.text,
        selection: nextSelection,
        clearActiveCell: target.source === 'activeCell',
        selectionAnchorPos,
    };
}

export function createTableClipboardRewriteSpec(state: EditorState, rewrite: TableClipboardRewrite): TransactionSpec {
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
        annotations: [cellSelectionTransitionAnnotation.of(true), tableClipboardRewriteAnnotation.of(true)],
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

interface SelectionClipboardCopy {
    clipboardData: DataTransfer;
    selection: CellSelection;
    markdown: string;
}

/** Shared copy/cut prelude: null whenever this event is not ours to serialize. */
function resolveSelectionClipboardCopy(event: ClipboardEvent, view: EditorView): SelectionClipboardCopy | null {
    const selection = getCellSelection(view.state);
    if (!selection || !event.clipboardData) {
        return null;
    }

    if (!canHandleTableSelectionKeydown(view)) {
        return null;
    }

    const markdown = copySelectionAsMarkdown(view.state, selection);
    if (!markdown) {
        return null;
    }

    return { clipboardData: event.clipboardData, selection, markdown };
}

function handleSelectionCopy(event: ClipboardEvent, view: EditorView): boolean {
    const copy = resolveSelectionClipboardCopy(event, view);
    if (!copy) {
        return false;
    }

    copy.clipboardData.setData('text/plain', copy.markdown);
    event.preventDefault();
    return true;
}

function handleSelectionCut(event: ClipboardEvent, view: EditorView): boolean {
    const copy = resolveSelectionClipboardCopy(event, view);
    if (!copy) {
        return false;
    }

    // Cutting copies the selection, then applies the same table rewrite as Delete.
    const rewrite = buildSelectionRemovalRewrite(view.state, copy.selection);
    if (!rewrite) {
        return false;
    }

    copy.clipboardData.setData('text/plain', copy.markdown);
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

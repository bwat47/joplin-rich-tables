import { EditorSelection, type StateEffect } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { clearActiveCellEffect } from '../../tableState/activeCellState';
import {
    cellSelectionTransitionAnnotation,
    clearCellSelectionEffect,
    getCellSelection,
    getSelectedTable,
    moveCellCoords,
    setCellSelectionEffect,
    type CellSelectionDirection,
    type CellSelectionEndpoints,
} from '../../tableState/cellSelectionState';
import type { TableContext } from '../../tableModel/tableContext';
import { getTableContextStartingAt } from '../../tableState/tableContextField';
import { isSameCellCoords, normalizeCellCoords, type CellCoords } from '../../tableModel/types';
import { findCellElement } from '../../tableWidget/domHelpers';
import { getResolvedActiveCell } from '../activeCell/resolvedActiveCell';
import { resolveClampedCell } from '../activeCell/activeCellFactory';
import { endCellDragEffect, isCellDragInProgress, startCellDragEffect } from '../../tableState/cellDragState';
import { exitTableToAdjacentLine, type TableExitSide } from '../navigation/tableExit';
import { requestOpenCell } from '../openCellRequest';

/**
 * Hands focus to the main editor for a cell selection it does not already hold.
 *
 * The main editor owns a cell selection's keyboard and clipboard commands, but none of the
 * gestures that create one leave focus there: shift-click preventDefaults its mousedown, and a
 * keyboard selection tears down the nested editor that had focus. Focus would otherwise sit on
 * the document body — workable, since `cellSelectionShortcutScope` treats that as soft focus, but
 * it reads as an unfocused selection.
 *
 * A running drag is the exception: it does not disturb whatever had focus until the rectangle is
 * final, and hands focus over itself on release. `cellSelectionVisuals.ts` keeps the selection
 * looking focused meanwhile, so nothing is gained by taking it early.
 */
function focusMainEditorForCellSelection(view: EditorView): void {
    if (getCellSelection(view.state) && !isCellDragInProgress(view.state) && !view.hasFocus) {
        view.focus();
    }
}

/**
 * Catches cell selections created outside this module.
 *
 * A paste inside a cell editor is rewritten into a multi-cell one by
 * `editorBridge/mainEditorGuard.ts`, and a transaction filter has neither a view to focus nor any
 * business running a side effect — so the selection arrives with focus still on the torn-down
 * nested editor's former home.
 *
 * The work waits for the measure phase because view plugins update before CodeMirror redraws, and
 * focusing writes the DOM selection, which has to happen against the new DOM. Selections this
 * module dispatched have taken focus synchronously by then, so this finds nothing left to do and
 * they never render unfocused for a frame.
 */
export const cellSelectionFocusPlugin = ViewPlugin.fromClass(
    class {
        update(update: ViewUpdate): void {
            const appeared = !getCellSelection(update.startState) && getCellSelection(update.state);
            if (!appeared) {
                return;
            }

            update.view.requestMeasure({
                read: () => undefined,
                write: (_measured, view) => focusMainEditorForCellSelection(view),
            });
        }
    }
);

interface SelectionDispatchOptions {
    clearActiveCell: boolean;
    scrollFocusIntoView?: boolean;
    extraEffects?: readonly StateEffect<unknown>[];
}

function dispatchSelectionWithContext(
    view: EditorView,
    ctx: TableContext,
    selection: CellSelectionEndpoints,
    options: SelectionDispatchOptions
): boolean {
    // User-intent coordinates can name a column a ragged row is missing. Identity
    // resolution would return null there; clamping lands on the nearest real cell.
    const resolvedAnchor = resolveClampedCell({ ctx, target: selection.anchor });
    const resolvedFocus = resolveClampedCell({ ctx, target: selection.focus });
    const focus = normalizeCellCoords(resolvedFocus.activeCell);

    view.dispatch({
        selection: EditorSelection.single(resolvedFocus.editableFrom),
        effects: [
            setCellSelectionEffect.of({
                tableFrom: ctx.from,
                anchor: normalizeCellCoords(resolvedAnchor.activeCell),
                focus,
            }),
            ...(options.clearActiveCell ? [clearActiveCellEffect.of(null)] : []),
            ...(options.extraEffects ?? []),
        ],
        annotations: cellSelectionTransitionAnnotation.of(true),
        scrollIntoView: false,
    });

    focusMainEditorForCellSelection(view);

    const cellElement = (options.scrollFocusIntoView ?? true) ? findCellElement(view, ctx.from, focus) : null;
    if (cellElement) {
        view.requestMeasure({
            read: () => cellElement.isConnected,
            write: (isConnected) => {
                if (isConnected) {
                    cellElement.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                }
            },
        });
    }

    return true;
}

/**
 * Sets the rectangle a mouse drag has swept out so far.
 *
 * The active cell is deliberately left alone: closing its nested editor would re-render the
 * cell and reflow the table the gesture is still hit-testing. `isCellDragInProgress` reports that
 * the drag owns the table until it settles, and the gesture clears the active cell on release.
 */
export function setCellDragSelection(
    view: EditorView,
    tableFrom: number,
    anchor: CellCoords,
    focus: CellCoords
): boolean {
    const ctx = getTableContextStartingAt(view.state, tableFrom);
    if (!ctx) {
        return false;
    }

    return dispatchSelectionWithContext(
        view,
        ctx,
        {
            anchor,
            focus,
        },
        {
            clearActiveCell: false,
            scrollFocusIntoView: false,
            extraEffects: [startCellDragEffect.of(null)],
        }
    );
}

/** Settles the state a drag left behind, on release or cancellation. */
export function endCellDragSelection(view: EditorView, options: { keepActiveCell: boolean }): void {
    view.dispatch({
        effects: [endCellDragEffect.of(null), ...(options.keepActiveCell ? [] : [clearActiveCellEffect.of(null)])],
    });
}

export function startCellSelectionFromActiveCell(view: EditorView, direction: CellSelectionDirection): boolean {
    const resolvedActiveCell = getResolvedActiveCell(view.state);
    if (!resolvedActiveCell) {
        return false;
    }

    const activeCell = resolvedActiveCell.activeCell;

    return dispatchSelectionWithContext(
        view,
        resolvedActiveCell.ctx,
        {
            anchor: activeCell,
            focus: moveCellCoords(activeCell, direction),
        },
        { clearActiveCell: true }
    );
}

export function extendExistingCellSelection(view: EditorView, direction: CellSelectionDirection): boolean {
    const selected = getSelectedTable(view.state);
    if (!selected) {
        return false;
    }

    const { selection, ctx } = selected;
    const clampedFocus = normalizeCellCoords(
        resolveClampedCell({
            ctx,
            target: moveCellCoords(selection.focus, direction),
        }).activeCell
    );

    // A selection is dropped on every document change it does not replace, and its anchor always
    // comes from a source-backed cell, so it names a real cell of this table.
    if (!isSameCellCoords(selection.focus, selection.anchor) && isSameCellCoords(clampedFocus, selection.anchor)) {
        requestOpenCell(view, {
            resolvedCell: resolveClampedCell({ ctx, target: selection.anchor }),
        });
        return true;
    }

    return dispatchSelectionWithContext(
        view,
        ctx,
        {
            anchor: selection.anchor,
            focus: clampedFocus,
        },
        { clearActiveCell: false }
    );
}

function exitSideForDirection(direction: CellSelectionDirection): TableExitSide {
    return direction === 'up' || direction === 'left' ? 'before' : 'after';
}

/**
 * Collapses a cell selection the way an unmodified arrow key collapses a text selection:
 * the highlight is dropped and the caret lands outside the table, on the side the arrow
 * points toward.
 *
 * Reports whether the key was consumed rather than whether the caret moved. A table
 * pressed against a document edge has no adjacent line to move to, but the selection
 * still has to go — letting the key fall through to the main editor there would move the
 * caret around inside the table's hidden Markdown with the highlight left behind.
 */
export function collapseCellSelectionOutOfTable(view: EditorView, direction: CellSelectionDirection): boolean {
    const selected = getSelectedTable(view.state);
    if (!selected) {
        return false;
    }

    const effects = [clearCellSelectionEffect.of(null)];
    if (!exitTableToAdjacentLine(view, selected.ctx, exitSideForDirection(direction), effects)) {
        view.dispatch({ effects });
    }

    return true;
}

export function setOrExtendCellSelectionToCoords(view: EditorView, focus: CellCoords, tableFrom: number): boolean {
    const selected = getSelectedTable(view.state);
    if (selected?.ctx.from === tableFrom) {
        const { selection, ctx } = selected;

        return dispatchSelectionWithContext(
            view,
            ctx,
            {
                anchor: selection.anchor,
                focus,
            },
            { clearActiveCell: false }
        );
    }

    const resolvedActiveCell = getResolvedActiveCell(view.state);
    if (resolvedActiveCell && resolvedActiveCell.ctx.from === tableFrom) {
        const activeCell = resolvedActiveCell.activeCell;

        return dispatchSelectionWithContext(
            view,
            resolvedActiveCell.ctx,
            {
                anchor: activeCell,
                focus,
            },
            { clearActiveCell: true }
        );
    }

    return false;
}

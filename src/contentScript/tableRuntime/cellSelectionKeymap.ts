import { redo, undo } from '@codemirror/commands';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { clearCellSelectionEffect, getCellSelection } from '../tableState/cellSelectionState';
import { getActiveCell, setActiveCellEffect } from '../tableState/activeCellState';
import { createActiveCellFromRanges } from './activeCellFactory';
import { extendExistingCellSelection, startCellSelectionFromActiveCell } from './cellSelectionController';
import { resolveTableAtPos } from './tablePositioning';
import { findCellElement } from '../tableWidget/domHelpers';
import { openNestedCellEditor } from '../nestedEditor/nestedCellEditor';
import { makeTableId } from '../tableModel/types';
import { buildTableContext } from '../tableModel/tableContext';
import { canHandleTableSelectionShortcut } from './cellSelectionShortcutScope';
import { handleSelectionDelete } from './cellSelectionClipboard';

export function extendOrStartSelection(view: EditorView, direction: 'left' | 'right' | 'up' | 'down'): boolean {
    if (getCellSelection(view.state)) {
        return extendExistingCellSelection(view, direction);
    }

    if (getActiveCell(view.state)) {
        return startCellSelectionFromActiveCell(view, direction);
    }

    return false;
}

export function clearSelectionIfActive(view: EditorView): boolean {
    if (!getCellSelection(view.state)) {
        return false;
    }

    view.dispatch({ effects: clearCellSelectionEffect.of(undefined) });
    return true;
}

export function activateSelectionFocus(view: EditorView): boolean {
    const selection = getCellSelection(view.state);
    if (!selection) {
        return false;
    }

    const table = resolveTableAtPos(view.state, selection.tableFrom);
    if (!table) {
        return false;
    }

    const ctx = buildTableContext(table);
    if (!ctx) {
        return false;
    }

    const nextActiveCell = createActiveCellFromRanges({
        tableFrom: ctx.from,
        ranges: ctx.cellRanges,
        target: selection.focus,
    });
    if (!nextActiveCell) {
        return false;
    }

    view.dispatch({
        effects: [clearCellSelectionEffect.of(undefined), setActiveCellEffect.of(nextActiveCell)],
        selection: { anchor: nextActiveCell.anchorPos },
        scrollIntoView: false,
    });

    const cellElement = findCellElement(view, makeTableId(ctx.from), nextActiveCell);
    if (!cellElement) {
        return true;
    }

    openNestedCellEditor({
        mainView: view,
        cellElement,
        activeCell: nextActiveCell,
        normalizeIfNeeded: true,
    });

    return true;
}

function runSelectionKeydown(view: EditorView, event: KeyboardEvent): boolean {
    if (!canHandleTableSelectionShortcut(view)) {
        return false;
    }

    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
        const command = event.shiftKey ? redo : undo;
        const handled = command(view);
        if (handled) {
            view.focus();
        }
        return handled;
    }

    if (event.ctrlKey && !event.metaKey && key === 'y') {
        const handled = redo(view);
        if (handled) {
            view.focus();
        }
        return handled;
    }

    switch (event.key) {
        case 'Backspace':
        case 'Delete':
            return !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && handleSelectionDelete(view);
        case 'ArrowLeft':
            return event.shiftKey && extendOrStartSelection(view, 'left');
        case 'ArrowRight':
            return event.shiftKey && extendOrStartSelection(view, 'right');
        case 'ArrowUp':
            return event.shiftKey && extendOrStartSelection(view, 'up');
        case 'ArrowDown':
            return event.shiftKey && extendOrStartSelection(view, 'down');
        case 'Escape':
            return clearSelectionIfActive(view);
        case 'Enter':
        case 'Tab':
            return !event.shiftKey && activateSelectionFocus(view);
        default:
            return false;
    }
}

export const cellSelectionKeyCapturePlugin = ViewPlugin.fromClass(
    class {
        private readonly onKeyDown: (event: KeyboardEvent) => void;

        constructor(private readonly view: EditorView) {
            this.onKeyDown = (event) => {
                if (!getCellSelection(this.view.state)) {
                    return;
                }

                if (!runSelectionKeydown(this.view, event)) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
            };

            this.view.dom.ownerDocument.addEventListener('keydown', this.onKeyDown, true);
        }

        destroy(): void {
            this.view.dom.ownerDocument.removeEventListener('keydown', this.onKeyDown, true);
        }
    }
);

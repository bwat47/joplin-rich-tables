import { EditorView, ViewPlugin } from '@codemirror/view';
import { getActiveCell, setActiveCellEffect } from './activeCellState';
import {
    clearCellSelectionEffect,
    extendExistingCellSelection,
    getCellSelection,
    startCellSelectionFromActiveCell,
} from './cellSelectionState';
import { findCellElement } from './domHelpers';
import { openNestedCellEditor } from '../nestedEditor/nestedCellEditor';
import { computeActiveCellFromRanges } from '../tableModel/activeCellForTableText';
import { makeTableId } from '../tableModel/types';
import { buildTableContext } from '../tableModel/tableContext';
import { resolveTableAtPos } from './tablePositioning';
import { canHandleTableSelectionShortcut } from './cellSelectionShortcutScope';

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

    const nextActiveCell = computeActiveCellFromRanges({
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

    switch (event.key) {
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


import { keymap, type EditorView } from '@codemirror/view';
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

function extendOrStartSelection(direction: 'left' | 'right' | 'up' | 'down') {
    return (view: EditorView): boolean => {
        if (getCellSelection(view.state)) {
            return extendExistingCellSelection(view, direction);
        }

        if (getActiveCell(view.state)) {
            return startCellSelectionFromActiveCell(view, direction);
        }

        return false;
    };
}

function clearSelectionIfActive(view: EditorView): boolean {
    if (!getCellSelection(view.state)) {
        return false;
    }

    view.dispatch({ effects: clearCellSelectionEffect.of(undefined) });
    return true;
}

function activateSelectionFocus(view: EditorView): boolean {
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
        effects: [
            clearCellSelectionEffect.of(undefined),
            setActiveCellEffect.of(nextActiveCell),
        ],
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

export const cellSelectionKeymap = keymap.of([
    { key: 'Shift-ArrowRight', run: extendOrStartSelection('right') },
    { key: 'Shift-ArrowLeft', run: extendOrStartSelection('left') },
    { key: 'Shift-ArrowUp', run: extendOrStartSelection('up') },
    { key: 'Shift-ArrowDown', run: extendOrStartSelection('down') },
    { key: 'Escape', run: clearSelectionIfActive },
    { key: 'Enter', run: activateSelectionFocus },
]);

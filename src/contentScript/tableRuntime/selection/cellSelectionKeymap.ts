import { redo, undo } from '@codemirror/commands';
import { EditorView, ViewPlugin, type Command } from '@codemirror/view';
import { clearCellSelectionEffect, getCellSelection } from '../../tableState/cellSelectionState';
import { getActiveCell } from '../../tableState/activeCellState';
import { createActiveCellFromRanges } from '../activeCell/activeCellFactory';
import { extendExistingCellSelection, startCellSelectionFromActiveCell } from './cellSelectionController';
import { resolveTableContextAtPos } from '../tableResolution';
import { canHandleTableSelectionKeydown } from './cellSelectionShortcutScope';
import { handleSelectionDelete } from './cellSelectionClipboard';
import { requestOpenCell } from '../openCellRequest';

type SelectionKeyHandler = (view: EditorView, event: KeyboardEvent) => boolean;

function extendOrStartSelection(view: EditorView, direction: 'left' | 'right' | 'up' | 'down'): boolean {
    if (getCellSelection(view.state)) {
        return extendExistingCellSelection(view, direction);
    }

    if (getActiveCell(view.state)) {
        return startCellSelectionFromActiveCell(view, direction);
    }

    return false;
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

    const ctx = resolveTableContextAtPos(view.state, selection.tableFrom);
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

    requestOpenCell(view, {
        target: {
            activeCell: nextActiveCell.activeCell,
            selectionAnchor: nextActiveCell.selectionAnchor,
        },
        clearCellSelection: true,
        normalizeIfNeeded: true,
        scrollIntoView: false,
    });

    return true;
}

function resolveHistoryCommand(event: KeyboardEvent): Command | null {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
        return event.shiftKey ? redo : undo;
    }

    if (event.ctrlKey && !event.metaKey && key === 'y') {
        return redo;
    }

    return null;
}

/**
 * Runs a history command against the main editor, moving focus there when it
 * applies. Undo/redo rewrites the document out from under the cell selection,
 * so leaving focus on the (now stale) table widget would strand the caret.
 */
function runHistoryCommand(view: EditorView, command: Command): boolean {
    const handled = command(view);
    if (handled) {
        view.focus();
    }

    return handled;
}

function handleDeleteKey(view: EditorView, event: KeyboardEvent): boolean {
    return !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && handleSelectionDelete(view);
}

const selectionKeyHandlers: ReadonlyMap<string, SelectionKeyHandler> = new Map([
    ['Backspace', handleDeleteKey],
    ['Delete', handleDeleteKey],
    ['ArrowLeft', (view, event) => event.shiftKey && extendOrStartSelection(view, 'left')],
    ['ArrowRight', (view, event) => event.shiftKey && extendOrStartSelection(view, 'right')],
    ['ArrowUp', (view, event) => event.shiftKey && extendOrStartSelection(view, 'up')],
    ['ArrowDown', (view, event) => event.shiftKey && extendOrStartSelection(view, 'down')],
    ['Escape', (view) => clearSelectionIfActive(view)],
    ['Enter', (view, event) => !event.shiftKey && activateSelectionFocus(view)],
    ['Tab', (view, event) => !event.shiftKey && activateSelectionFocus(view)],
]);

function runSelectionKeydown(view: EditorView, event: KeyboardEvent): boolean {
    if (!canHandleTableSelectionKeydown(view)) {
        return false;
    }

    const historyCommand = resolveHistoryCommand(event);
    if (historyCommand) {
        return runHistoryCommand(view, historyCommand);
    }

    return selectionKeyHandlers.get(event.key)?.(view, event) ?? false;
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

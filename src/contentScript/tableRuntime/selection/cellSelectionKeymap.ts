import { redo, undo } from '@codemirror/commands';
import { EditorView, ViewPlugin, type Command } from '@codemirror/view';
import {
    clearCellSelectionEffect,
    getCellSelection,
    type CellSelectionDirection,
} from '../../tableState/cellSelectionState';
import { getActiveCell } from '../../tableState/activeCellState';
import { createActiveCellFromRanges } from '../activeCell/activeCellFactory';
import {
    collapseCellSelectionOutOfTable,
    extendExistingCellSelection,
    startCellSelectionFromActiveCell,
} from './cellSelectionController';
import { resolveTableContextAtPos } from '../tableResolution';
import { canHandleTableSelectionKeydown } from './cellSelectionShortcutScope';
import { handleSelectionDelete } from './cellSelectionClipboard';
import { requestOpenCell } from '../openCellRequest';

type SelectionKeyHandler = (view: EditorView, event: KeyboardEvent) => boolean;

function extendOrStartSelection(view: EditorView, direction: CellSelectionDirection): boolean {
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

/**
 * Every Backspace/Delete removes the selected cells: word- and line-wise deletion have no
 * meaning over a rectangle of cells, so the modifiers carry no extra behavior to preserve.
 * Shift+Delete is the exception - it is the platform's cut gesture, and belongs to the
 * clipboard handler.
 */
function handleDeleteKey(view: EditorView, event: KeyboardEvent): boolean {
    if (event.key === 'Delete' && event.shiftKey) {
        return false;
    }

    return handleSelectionDelete(view);
}

/** Enter and Tab both open the focus cell; Shift+Enter/Tab are left to the editor. */
function handleActivateKey(view: EditorView, event: KeyboardEvent): boolean {
    return !event.shiftKey && activateSelectionFocus(view);
}

function hasNoModifiers(event: KeyboardEvent): boolean {
    return !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
}

/**
 * Shift+Arrow extends the selection; a bare arrow collapses it and leaves the table.
 * Modified arrows (word/line movement) are left to the main editor, which moves the
 * caret out of the table's range and lets the selection guard drop the highlight.
 */
function arrowKeyHandler(direction: CellSelectionDirection): SelectionKeyHandler {
    return (view, event) => {
        if (event.shiftKey) {
            return extendOrStartSelection(view, direction);
        }

        return hasNoModifiers(event) && collapseCellSelectionOutOfTable(view, direction);
    };
}

const selectionKeyHandlers: ReadonlyMap<string, SelectionKeyHandler> = new Map([
    ['Backspace', handleDeleteKey],
    ['Delete', handleDeleteKey],
    ['ArrowLeft', arrowKeyHandler('left')],
    ['ArrowRight', arrowKeyHandler('right')],
    ['ArrowUp', arrowKeyHandler('up')],
    ['ArrowDown', arrowKeyHandler('down')],
    ['Escape', (view) => clearSelectionIfActive(view)],
    ['Enter', handleActivateKey],
    ['Tab', handleActivateKey],
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

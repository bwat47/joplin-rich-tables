import {
    defaultKeymap,
    deleteCharBackward,
    deleteCharForward,
    deleteGroupBackward,
    deleteGroupForward,
    deleteLine,
    deleteLineBoundaryBackward,
    deleteLineBoundaryForward,
    deleteToLineEnd,
} from '@codemirror/commands';
import { EditorView, keymap, runScopeHandlers, ViewPlugin, type Command, type KeyBinding } from '@codemirror/view';
import { getCellSelection, getSelectedTable, type CellSelectionDirection } from '../../tableState/cellSelectionState';
import { getActiveCell } from '../../tableState/activeCellState';
import { resolveClampedCell } from '../activeCell/activeCellFactory';
import {
    collapseCellSelectionOutOfTable,
    extendExistingCellSelection,
    startCellSelectionFromActiveCell,
} from './cellSelectionController';
import { canHandleTableSelectionKeydown } from './cellSelectionShortcutScope';
import { handleSelectionDelete, isNativeClipboardShortcut } from './cellSelectionClipboard';
import { requestOpenCell } from '../openCellRequest';
import { createHistoryKeyBindings } from '../historyKeymap';

/** Dedicated keymap scope so these bindings never match the root editor's ordinary keyboard handling. */
const CELL_SELECTION_SCOPE = 'table.cellSelection';

const ARROW_BINDINGS: ReadonlyArray<{ key: string; direction: CellSelectionDirection }> = [
    { key: 'ArrowLeft', direction: 'left' },
    { key: 'ArrowRight', direction: 'right' },
    { key: 'ArrowUp', direction: 'up' },
    { key: 'ArrowDown', direction: 'down' },
];

const SELECTION_ACTIVATION_KEYS = ['Enter', 'Tab', 'Escape'] as const;

/**
 * Deletion commands currently represented in `defaultKeymap`. Word- and line-wise
 * variants all clear the same rectangle; only the chords that invoke them differ.
 */
function isRectangleDeletionCommand(command: KeyBinding['run'] | KeyBinding['shift']): boolean {
    return (
        command === deleteCharBackward ||
        command === deleteCharForward ||
        command === deleteGroupBackward ||
        command === deleteGroupForward ||
        command === deleteLineBoundaryBackward ||
        command === deleteLineBoundaryForward ||
        command === deleteLine ||
        command === deleteToLineEnd
    );
}

function isRectangleDeletionBinding(binding: KeyBinding): boolean {
    return isRectangleDeletionCommand(binding.run) || isRectangleDeletionCommand(binding.shift);
}

/**
 * Rectangle deletion follows CodeMirror's default chords, including Shift-Mod-K and
 * macOS Emacs-style Ctrl-D/H/K and Ctrl-Alt-H. Shift+Delete is not adapted: it is the
 * platform cut gesture and belongs to the clipboard handler.
 */
function createRectangleDeletionBindings(): KeyBinding[] {
    return defaultKeymap.filter(isRectangleDeletionBinding).map((binding) => ({
        key: binding.key,
        mac: binding.mac,
        win: binding.win,
        linux: binding.linux,
        preventDefault: binding.preventDefault,
        run: handleSelectionDelete,
        ...(binding.shift ? { shift: handleSelectionDelete } : {}),
        scope: CELL_SELECTION_SCOPE,
    }));
}

function extendOrStartSelection(view: EditorView, direction: CellSelectionDirection): boolean {
    if (getCellSelection(view.state)) {
        return extendExistingCellSelection(view, direction);
    }

    if (getActiveCell(view.state)) {
        return startCellSelectionFromActiveCell(view, direction);
    }

    return false;
}

function activateSelectionFocus(view: EditorView): boolean {
    const selected = getSelectedTable(view.state);
    if (!selected) {
        return false;
    }

    requestOpenCell(view, {
        resolvedCell: resolveClampedCell({ ctx: selected.ctx, target: selected.selection.focus }),
        clearCellSelection: true,
        scrollIntoView: false,
    });

    return true;
}

/**
 * Runs a history command against the main editor, moving focus there when it
 * applies. Undo/redo rewrites the document out from under the cell selection,
 * so leaving focus on the (now stale) table widget would strand the caret.
 */
function runCellSelectionHistory(view: EditorView, command: Command): boolean {
    const handled = command(view);
    if (handled) {
        view.focus();
    }

    return handled;
}

function createArrowBinding(key: string, direction: CellSelectionDirection): KeyBinding {
    return {
        key,
        run: (view) => collapseCellSelectionOutOfTable(view, direction),
        shift: (view) => extendOrStartSelection(view, direction),
        scope: CELL_SELECTION_SCOPE,
    };
}

function createCellSelectionKeyBindings(): KeyBinding[] {
    return [
        ...createHistoryKeyBindings(runCellSelectionHistory, CELL_SELECTION_SCOPE),
        ...createRectangleDeletionBindings(),
        ...ARROW_BINDINGS.map(({ key, direction }) => createArrowBinding(key, direction)),
        ...SELECTION_ACTIVATION_KEYS.map((key) => ({
            key,
            run: activateSelectionFocus,
            scope: CELL_SELECTION_SCOPE,
        })),
    ];
}

function runSelectionKeydown(view: EditorView, event: KeyboardEvent): boolean {
    if (!canHandleTableSelectionKeydown(view)) {
        return false;
    }

    return runScopeHandlers(view, event, CELL_SELECTION_SCOPE);
}

export const cellSelectionKeyCapturePlugin = ViewPlugin.fromClass(
    class {
        private readonly onKeyDown: (event: KeyboardEvent) => void;

        constructor(private readonly view: EditorView) {
            this.onKeyDown = (event) => {
                if (!getCellSelection(this.view.state)) {
                    return;
                }

                if (isNativeClipboardShortcut(event) && canHandleTableSelectionKeydown(this.view)) {
                    // Preserve the native default so copy/cut/paste still fires. Stopping
                    // propagation prevents the root editor from acting on its parked caret first.
                    event.stopPropagation();
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
    },
    {
        provide: () => keymap.of(createCellSelectionKeyBindings()),
    }
);

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
import { type EditorView, keymap, runScopeHandlers, ViewPlugin, type Command, type KeyBinding } from '@codemirror/view';
import { getCellSelection, getSelectedTable, type CellSelectionDirection } from '../../tableState/cellSelectionState';
import { getActiveCell } from '../../tableState/activeCellState';
import { resolveClampedCell } from '../../tableState/resolvedActiveCell';
import {
    collapseCellSelectionOutOfTable,
    extendExistingCellSelection,
    startCellSelectionFromActiveCell,
} from './cellSelectionController';
import { canHandleTableSelectionKeydown } from './cellSelectionShortcutScope';
import { handleSelectionDelete } from './cellSelectionClipboard';
import { requestOpenCell } from '../openCellRequest';
import { createHistoryKeyBindings } from '../historyKeymap';
import type { InitialCursorPos } from '../../tableState/cursorPlacement';

/** Dedicated keymap scope so these bindings never match the root editor's ordinary keyboard handling. */
const CELL_SELECTION_SCOPE = 'table.cellSelection';

/**
 * Separate scope for clipboard chords: a match must stop propagation but keep the native
 * default, which the ordinary selection scope's preventDefault handling cannot express.
 */
const CLIPBOARD_PASSTHROUGH_SCOPE = 'table.cellSelection.clipboard';

/**
 * The chords that make the browser emit a clipboard event, which is where a table
 * selection is serialized and rewritten. Shift-Mod-C and friends are left out: they
 * belong to other handlers. A chord missing here still pastes correctly, since the
 * clipboard event has its own listener; it just no longer hides the keydown from the
 * root editor.
 */
const CLIPBOARD_PASSTHROUGH_KEYS = ['Mod-c', 'Mod-x', 'Mod-v', 'Ctrl-Insert', 'Shift-Insert', 'Shift-Delete'] as const;

const ARROW_BINDINGS: ReadonlyArray<{ key: string; direction: CellSelectionDirection }> = [
    { key: 'ArrowLeft', direction: 'left' },
    { key: 'ArrowRight', direction: 'right' },
    { key: 'ArrowUp', direction: 'up' },
    { key: 'ArrowDown', direction: 'down' },
];

const SELECTION_ACTIVATION_KEYS = ['Enter', 'Tab', 'Escape'] as const;

/** `KeyboardEvent.key` for a dead key, which starts an accent composition rather than typing. */
const DEAD_KEY = 'Dead';

/** `KeyboardEvent.key` for a keystroke an IME consumes, such as the one that starts a composition. */
const IME_PROCESS_KEY = 'Process';

/** `getModifierState` name for the AltGr key. */
const ALT_GRAPH_MODIFIER = 'AltGraph';

/**
 * Matches a `KeyboardEvent.key` naming exactly one character, as opposed to a named key.
 * The `u` flag counts an astral character as one, so `'😀'` matches.
 *
 * @example 'a', 'A', ' ', 'é', '€' match; 'Enter', 'ArrowLeft', 'Shift' do not.
 */
const SINGLE_CHARACTER_KEY = /^.$/u;

/** Where typed text goes in the focus cell: appended, so the keystroke never discards its content. */
const TEXT_INPUT_CURSOR_POS: InitialCursorPos = 'end';

/**
 * Deletion commands currently represented in `defaultKeymap`. Word- and line-wise
 * variants all clear the same rectangle; only the chords that invoke them differ.
 */
function isRectangleDeletionCommand(command: KeyBinding['run']): boolean {
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
 * Clears the rectangle and claims the chord either way. While a cell selection is live the
 * main caret is parked inside the focus cell, so a deletion chord that fell through would
 * edit document text the user cannot see. A rewrite that declines is a no-op, not a reason
 * to hand the key to the main editor.
 */
const clearSelectionRectangle: Command = (view) => {
    handleSelectionDelete(view);
    return true;
};

/**
 * Rectangle deletion follows CodeMirror's default chords, including Shift-Mod-K and
 * macOS Emacs-style Ctrl-D/H/K and Ctrl-Alt-H. Shift+Delete is not adapted: it is the
 * platform cut gesture and belongs to the clipboard handler.
 *
 * `preventDefault` is deliberately not inherited: `clearSelectionRectangle` always reports
 * the chord as handled, so the capture plugin suppresses the event itself. Copying the flag
 * would make suppression depend on which chord was pressed, since `standardKeymap` drops it
 * when it re-maps the Emacs-style bindings.
 */
function createRectangleDeletionBindings(): KeyBinding[] {
    return defaultKeymap.filter(isRectangleDeletionBinding).map((binding) => ({
        key: binding.key,
        mac: binding.mac,
        win: binding.win,
        linux: binding.linux,
        run: clearSelectionRectangle,
        ...(binding.shift ? { shift: clearSelectionRectangle } : {}),
        scope: CELL_SELECTION_SCOPE,
    }));
}

/**
 * Reports the chord as matched without acting on it. The capture plugin only stops
 * propagation for this scope, so the browser still runs its clipboard default.
 */
const claimClipboardChord: Command = () => true;

function createClipboardPassthroughBindings(): KeyBinding[] {
    return CLIPBOARD_PASSTHROUGH_KEYS.map((key) => ({
        key,
        run: claimClipboardChord,
        scope: CLIPBOARD_PASSTHROUGH_SCOPE,
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

function openSelectionFocusCell(view: EditorView, initialCursorPos?: InitialCursorPos): boolean {
    const selected = getSelectedTable(view.state);
    if (!selected) {
        return false;
    }

    requestOpenCell(view, {
        resolvedCell: resolveClampedCell({ ctx: selected.ctx, target: selected.selection.focus }),
        initialCursorPos,
        scrollIntoView: false,
    });

    return true;
}

const activateSelectionFocus: Command = (view) => openSelectionFocusCell(view);

/**
 * True for a keystroke whose default action types text. Ctrl and Meta chords are commands,
 * except AltGr, which Windows also reports as Ctrl+Alt; the `AltGraph` modifier tells it
 * apart from a pressed Ctrl+Alt shortcut. A keystroke during an IME composition belongs to
 * that composition, wherever it is running.
 */
function isTextInputKey(event: KeyboardEvent): boolean {
    if (event.isComposing || event.metaKey) {
        return false;
    }

    if (event.ctrlKey && !event.getModifierState(ALT_GRAPH_MODIFIER)) {
        return false;
    }

    return event.key === DEAD_KEY || event.key === IME_PROCESS_KEY || SINGLE_CHARACTER_KEY.test(event.key);
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
        ...createClipboardPassthroughBindings(),
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

                if (
                    canHandleTableSelectionKeydown(this.view) &&
                    runScopeHandlers(this.view, event, CLIPBOARD_PASSTHROUGH_SCOPE)
                ) {
                    // Preserve the native default so copy/cut/paste still fires. Stopping
                    // propagation prevents the root editor from acting on its parked caret first.
                    event.stopPropagation();
                    return;
                }

                if (runSelectionKeydown(this.view, event)) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }

                if (isTextInputKey(event) && canHandleTableSelectionKeydown(this.view)) {
                    // The default is kept on purpose. The cell editor mounts and takes focus in a
                    // microtask, which runs before the browser inserts the text, so the keystroke
                    // types into the cell. Stopping propagation keeps the root editor from acting on
                    // the key against its caret parked in the table's hidden Markdown.
                    openSelectionFocusCell(this.view, TEXT_INPUT_CURSOR_POS);
                    event.stopPropagation();
                }
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

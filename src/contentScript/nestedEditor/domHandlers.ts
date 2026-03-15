import { EditorSelection, StateCommand, Transaction } from '@codemirror/state';
import { undo, redo } from '@codemirror/commands';
import { EditorView, keymap } from '@codemirror/view';
import { clearActiveCellEffect, getActiveCell } from '../tableWidget/activeCellState';
import { navigateCell } from '../tableWidget/tableNavigation';
import { startCellSelectionFromActiveCell } from '../tableWidget/cellSelectionState';
import { syncAnnotation } from './transactionPolicy';

function runHistoryCommand(mainView: EditorView, command: StateCommand): boolean {
    const activeCellBefore = getActiveCell(mainView.state);
    const scrollSnapshot = mainView.scrollSnapshot();
    const result = command(mainView);
    if (!result) {
        return false;
    }

    const activeCellAfter = getActiveCell(mainView.state);
    const stayedInSameCell =
        activeCellBefore &&
        activeCellAfter &&
        activeCellBefore.section === activeCellAfter.section &&
        activeCellBefore.row === activeCellAfter.row &&
        activeCellBefore.col === activeCellAfter.col &&
        activeCellBefore.anchorPos === activeCellAfter.anchorPos;

    if (stayedInSameCell) {
        mainView.dispatch({
            effects: scrollSnapshot,
            annotations: Transaction.addToHistory.of(false),
        });
    }

    return true;
}

export function createNestedEditorKeymap(
    mainView: EditorView,
    options: {
        getSelectionBounds: (view: EditorView) => { from: number; to: number };
        closeEditor: () => void;
        extraBindings?: Record<string, StateCommand>;
    }
) {
    const bindings = [
        { key: 'Mod-z', run: () => runHistoryCommand(mainView, undo) },
        { key: 'Mod-y', run: () => runHistoryCommand(mainView, redo) },
        { key: 'Mod-Shift-z', run: () => runHistoryCommand(mainView, redo) },
        { key: 'Tab', run: () => navigateCell(mainView, 'next', { allowRowCreation: true }) },
        { key: 'Shift-Tab', run: () => navigateCell(mainView, 'previous') },
        { key: 'Enter', run: () => navigateCell(mainView, 'down', { allowRowCreation: true }) },
        {
            key: 'ArrowLeft',
            run: (nestedView) => {
                const { from } = options.getSelectionBounds(nestedView);
                if (nestedView.state.selection.main.head === from) {
                    return navigateCell(mainView, 'previous', { cursorPos: 'end' });
                }
                return false;
            },
        },
        {
            key: 'ArrowRight',
            run: (nestedView) => {
                const { to } = options.getSelectionBounds(nestedView);
                if (nestedView.state.selection.main.head === to) {
                    return navigateCell(mainView, 'next', { cursorPos: 'start' });
                }
                return false;
            },
        },
        {
            key: 'ArrowUp',
            run: (nestedView) => {
                const { from } = options.getSelectionBounds(nestedView);
                const { head } = nestedView.state.selection.main;
                const headRect = nestedView.coordsAtPos(head);
                const fromRect = nestedView.coordsAtPos(from);

                if (headRect && fromRect && Math.abs(headRect.top - fromRect.top) < 2) {
                    return navigateCell(mainView, 'up', { cursorPos: 'start' });
                }

                if (head === from) {
                    return navigateCell(mainView, 'up', { cursorPos: 'start' });
                }

                return false;
            },
        },
        {
            key: 'ArrowDown',
            run: (nestedView) => {
                const { to } = options.getSelectionBounds(nestedView);
                const { head } = nestedView.state.selection.main;
                const headRect = nestedView.coordsAtPos(head);
                const toRect = nestedView.coordsAtPos(to);

                if (headRect && toRect && Math.abs(headRect.top - toRect.top) < 2) {
                    return navigateCell(mainView, 'down', { cursorPos: 'start' });
                }

                if (head === to) {
                    return navigateCell(mainView, 'down', { cursorPos: 'start' });
                }

                return false;
            },
        },
        {
            key: 'Shift-ArrowLeft',
            run: (nestedView) => {
                const { from } = options.getSelectionBounds(nestedView);
                if (nestedView.state.selection.main.head !== from) {
                    return false;
                }

                options.closeEditor();
                return startCellSelectionFromActiveCell(mainView, 'left');
            },
        },
        {
            key: 'Shift-ArrowRight',
            run: (nestedView) => {
                const { to } = options.getSelectionBounds(nestedView);
                if (nestedView.state.selection.main.head !== to) {
                    return false;
                }

                options.closeEditor();
                return startCellSelectionFromActiveCell(mainView, 'right');
            },
        },
        {
            key: 'Shift-ArrowUp',
            run: (nestedView) => {
                const { from } = options.getSelectionBounds(nestedView);
                const { head } = nestedView.state.selection.main;
                const headRect = nestedView.coordsAtPos(head);
                const fromRect = nestedView.coordsAtPos(from);

                if (!((headRect && fromRect && Math.abs(headRect.top - fromRect.top) < 2) || head === from)) {
                    return false;
                }

                options.closeEditor();
                return startCellSelectionFromActiveCell(mainView, 'up');
            },
        },
        {
            key: 'Shift-ArrowDown',
            run: (nestedView) => {
                const { to } = options.getSelectionBounds(nestedView);
                const { head } = nestedView.state.selection.main;
                const headRect = nestedView.coordsAtPos(head);
                const toRect = nestedView.coordsAtPos(to);

                if (!((headRect && toRect && Math.abs(headRect.top - toRect.top) < 2) || head === to)) {
                    return false;
                }

                options.closeEditor();
                return startCellSelectionFromActiveCell(mainView, 'down');
            },
        },
    ];

    if (options.extraBindings) {
        for (const [key, command] of Object.entries(options.extraBindings)) {
            bindings.push({ key, run: command });
        }
    }

    return keymap.of(bindings);
}

export function createNestedEditorDomHandlers(
    mainView: EditorView,
    options: {
        syncSelectionToMain: (view: EditorView, event?: MouseEvent) => void;
        closeEditor: () => void;
        ensureRootSelectionForCommand: () => void;
    }
) {
    return EditorView.domEventHandlers({
        beforeinput: (e) => {
            e.stopPropagation();
            return false;
        },
        input: (e) => {
            e.stopPropagation();
            return false;
        },
        compositionstart: (e) => {
            e.stopPropagation();
            return false;
        },
        compositionupdate: (e) => {
            e.stopPropagation();
            return false;
        },
        compositionend: (e) => {
            e.stopPropagation();
            return false;
        },
        keydown: (e) => {
            const isMod = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();

            if (isMod && key === 'f') {
                options.closeEditor();
                if (getActiveCell(mainView.state)) {
                    mainView.dispatch({ effects: clearActiveCellEffect.of(undefined) });
                }
                return false;
            }

            if (isMod && ['b', 'i', 'u', '`', 'e', 'k'].includes(key)) {
                options.ensureRootSelectionForCommand();
                return false;
            }

            if (isMod && ['s', 'p', 'v'].includes(key)) {
                return false;
            }

            e.stopPropagation();
            return false;
        },
        mousedown: (e, view) => {
            const mouseEvent = e as MouseEvent;
            if (mouseEvent.button === 2) {
                options.syncSelectionToMain(view, mouseEvent);
            }
            return false;
        },
        contextmenu: (e, view) => {
            const mouseEvent = e as MouseEvent;
            if (mouseEvent.button === 2) {
                options.syncSelectionToMain(view, mouseEvent);
            }
            return false;
        },
    });
}

export function mirrorLocalSelectionToMain(params: {
    nestedView: EditorView;
    mainView: EditorView;
    selection: { anchor: number; head: number };
}): void {
    params.nestedView.focus();
    params.mainView.dispatch({
        selection: EditorSelection.single(params.selection.anchor, params.selection.head),
        annotations: [syncAnnotation.of(true), Transaction.addToHistory.of(false)],
        scrollIntoView: false,
    });
}

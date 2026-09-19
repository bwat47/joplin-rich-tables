import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { nestedEditorLifecyclePlugin } from '../tableRuntime/lifecycle/nestedEditorLifecycle';
import {
    activateInsertedTableEffect,
    getPendingInsertedTableActivation,
    insertedTableActivationField,
} from '../tableState/insertedTableActivation';
import {
    activeCellField,
    clearActiveCellEffect,
    getActiveCell,
    setActiveCellEffect,
    type ActiveCell,
} from '../tableState/activeCellState';
import { searchForceSourceModeField } from '../tableState/searchForceSourceMode';
import { exitSourceModeEffect, sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { structuralTableEditEffect } from '../tableState/structuralTableEditEffect';
import { tableContextField } from '../tableState/tableContextField';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { resolveActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { triggerOpenCellRequestEffect } from '../tableRuntime/openCellRequest';
import {
    beginOpenCellRequestEffect,
    getPendingOpenCellRequest,
    openCellRequestField,
    type OpenCellRequest,
} from '../tableRuntime/openCellRequest';
import type { HostEditorConfig } from '../../contentScriptBridge/hostEditorConfigBridge';
import { createActiveCellForTable } from '../tableRuntime/activeCell/activeCellFactory';
import { parseTableFixture } from './testUtils';
import type { InitialCursorPos } from '../shared/cursorPlacement';
import { hostEditorConfigFacet } from '../services/hostEditorConfig';
import * as nestedEditorController from '../nestedEditor/nestedEditorController';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { noteIdentityFacet } from '../services/noteIdentity';

class ResizeObserverMock {
    observe(): void {}
    disconnect(): void {}
}

const { activateCellAtPositionMock, activateTableCellMock, findCellElementMock } = vi.hoisted(() => ({
    activateCellAtPositionMock: vi.fn(),
    activateTableCellMock: vi.fn(),
    findCellElementMock: vi.fn<(...args: unknown[]) => HTMLTableCellElement | null>(() => document.createElement('td')),
}));
const DEFAULT_FEATURE_SETTINGS = {
    autoMatchingBraces: true,
    spellcheck: false,
} satisfies HostEditorConfig['nestedEditor'];
const TEST_HOST_CONFIG = {
    nestedEditor: DEFAULT_FEATURE_SETTINGS,
    tableAppearance: {
        zebraStriping: false,
    },
    toolbar: {
        showMoveButtons: true,
        showClearButtons: true,
        showAlignmentButtons: true,
        showDeleteTableButton: true,
        showSortButtons: true,
    },
} satisfies HostEditorConfig;
const nestedEditorControllerMock = nestedEditorController as unknown as {
    closeNestedEditor: Mock;
    isNestedEditorOpen: Mock;
    openNestedEditor: Mock;
};
const NON_CANONICAL_DOC = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');
const CANONICAL_DOC = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');
const INITIAL_NOTE_ID = 'note-a';
const noteConfiguration = new Compartment();
const NOTE_SWITCH_PREFIX = 'intro\n\n';
const NOTE_SWITCH_DOC = [NOTE_SWITCH_PREFIX + CANONICAL_DOC, '', 'outro'].join('\n');
const NOTE_SWITCH_TABLE_FROM = NOTE_SWITCH_PREFIX.length;
const NOTE_SWITCH_TABLE_TO = NOTE_SWITCH_TABLE_FROM + CANONICAL_DOC.length;
const NOTE_SWITCH_POS_IN_TABLE = NOTE_SWITCH_TABLE_FROM + '| H'.length;
const NOTE_SWITCH_POS_OUTSIDE_TABLE = NOTE_SWITCH_DOC.indexOf('outro') + 2;

function headerCell(overrides: Partial<ActiveCell> = {}): ActiveCell {
    return {
        tableFrom: 0,
        section: 'header',
        row: 0,
        col: 0,
        ...overrides,
    };
}

function createLifecycleState(params: {
    doc: string;
    activeCell?: ActiveCell;
    includeInsertedTableActivation?: boolean;
    selection?: { anchor: number; head?: number };
}): EditorState {
    let state = EditorState.create({
        doc: params.doc,
        selection: params.selection,
        extensions: [
            markdown({ extensions: [GFM] }),
            tableContextField,
            activeCellField,
            openCellRequestField,
            ...(params.includeInsertedTableActivation ? [insertedTableActivationField] : []),
            searchForceSourceModeField,
            sourceModeField,
            hostEditorConfigFacet.of(TEST_HOST_CONFIG),
            noteConfiguration.of(noteIdentityFacet.of(INITIAL_NOTE_ID)),
            tableDecorationField,
            nestedEditorLifecyclePlugin,
        ],
    });

    if (params.activeCell) {
        state = state.update({ effects: setActiveCellEffect.of(params.activeCell) }).state;
    }

    return state;
}

function createLifecycleView(params: Parameters<typeof createLifecycleState>[0]): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    return new EditorView({
        parent,
        state: createLifecycleState(params),
    });
}

function openRequestEffects(params: {
    requestId: string;
    activeCell: ActiveCell;
    initialCursorPos?: InitialCursorPos;
}) {
    const request: OpenCellRequest = {
        requestId: params.requestId,
        activeCell: params.activeCell,
        initialCursorPos: params.initialCursorPos,
        suppressKeys: false,
    };

    return [
        beginOpenCellRequestEffect.of(request),
        triggerOpenCellRequestEffect.of({
            requestId: params.requestId,
        }),
    ];
}

vi.mock('../tableRuntime/activeCell/cellActivation', () => ({
    activateCellAtPosition: (...args: unknown[]) => activateCellAtPositionMock(...args),
    activateTableCell: (...args: unknown[]) => activateTableCellMock(...args),
}));

vi.mock('../tableWidget/domHelpers', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../tableWidget/domHelpers')>()),
    findCellElement: (view: unknown, tableId: unknown, activeCell: unknown) =>
        findCellElementMock(view, tableId, activeCell),
}));

vi.mock('../nestedEditor/nestedEditorController', () => ({
    cleanupHostedNestedEditors: vi.fn(),
    closeNestedEditor: vi.fn(),
    handleMainEditorUpdate: vi.fn(),
    isNestedEditorOpen: vi.fn(() => false),
    openNestedEditor: vi.fn(),
}));

describe('nestedEditorLifecycle', () => {
    let animationFrameQueue: FrameRequestCallback[] = [];

    const flushAnimationFrames = (): void => {
        while (animationFrameQueue.length > 0) {
            const callback = animationFrameQueue.shift();
            callback?.(0);
        }
    };

    beforeEach(() => {
        activateCellAtPositionMock.mockReset();
        activateTableCellMock.mockReset();
        findCellElementMock.mockClear();
        nestedEditorControllerMock.closeNestedEditor.mockReset();
        nestedEditorControllerMock.isNestedEditorOpen.mockReset();
        nestedEditorControllerMock.openNestedEditor.mockReset();
        nestedEditorControllerMock.openNestedEditor.mockReturnValue(true);
        nestedEditorControllerMock.isNestedEditorOpen.mockReturnValue(false);
        animationFrameQueue = [];
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
            animationFrameQueue.push(callback);
            return animationFrameQueue.length;
        }) as typeof requestAnimationFrame);
        vi.stubGlobal('ResizeObserver', ResizeObserverMock as unknown as typeof ResizeObserver);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('schedules inserted-table activation from the effect payload', () => {
        const view = createLifecycleView({
            doc: '',
            includeInsertedTableActivation: true,
        });

        view.dispatch({
            effects: activateInsertedTableEffect.of({
                tableFrom: 42,
                target: { section: 'header', row: 0, col: 0 },
            }),
        });
        flushAnimationFrames();

        expect(activateTableCellMock).toHaveBeenCalledWith(view, 42, {
            section: 'header',
            row: 0,
            col: 0,
        });

        view.destroy();
    });

    it('uses the mapped pending inserted-table activation when text shifts before the scheduled frame', () => {
        const doc = ['before', '', CANONICAL_DOC].join('\n');
        const tableFrom = 'before\n\n'.length;
        const insertedText = 'top\n';
        const view = createLifecycleView({
            doc,
            includeInsertedTableActivation: true,
        });

        view.dispatch({
            effects: activateInsertedTableEffect.of({
                tableFrom,
                target: { section: 'header', row: 0, col: 0 },
            }),
        });
        view.dispatch({ changes: { from: 0, to: 0, insert: insertedText } });
        flushAnimationFrames();

        expect(activateTableCellMock).toHaveBeenCalledWith(view, tableFrom + insertedText.length, {
            section: 'header',
            row: 0,
            col: 0,
        });
        expect(getPendingInsertedTableActivation(view.state)).toBeNull();

        view.destroy();
    });

    it('passes the mapped cell range when undo or redo closes the nested editor', () => {
        nestedEditorControllerMock.isNestedEditorOpen.mockReturnValue(true);

        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const activeCell = headerCell();
        const view = createLifecycleView({
            doc,
            activeCell,
        });

        view.dispatch({
            changes: { from: 0, to: 0, insert: 'abc\n' },
            annotations: Transaction.userEvent.of('redo'),
        });

        const resolved = resolveActiveCell(view.state, getActiveCell(view.state));
        expect(resolved).not.toBeNull();
        if (!resolved) {
            throw new Error('Expected resolved active cell after redo');
        }

        expect(nestedEditorControllerMock.closeNestedEditor).toHaveBeenCalledWith(view, {
            contentFrom: resolved.contentFrom,
            contentTo: resolved.contentTo,
        });

        view.destroy();
    });

    it('renders tables immediately and repositions after a full replace with a cell open', () => {
        nestedEditorControllerMock.isNestedEditorOpen.mockReturnValue(true);

        const view = createLifecycleView({ doc: CANONICAL_DOC, activeCell: headerCell() });
        const replacement = ['intro', '', CANONICAL_DOC, '', CANONICAL_DOC.replace('a', 'c')].join('\n');

        // Mirrors an external sync: the main editor guard adds the clear to the replacing transaction.
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: replacement },
            selection: { anchor: 0 },
            effects: clearActiveCellEffect.of(undefined),
        });

        expect(view.contentDOM.querySelectorAll('table')).toHaveLength(2);
        expect(nestedEditorControllerMock.closeNestedEditor).toHaveBeenCalledTimes(1);

        const decorationsAfterReplace = view.state.field(tableDecorationField).decorations;
        flushAnimationFrames();

        expect(activateCellAtPositionMock).toHaveBeenCalledWith(
            view,
            0,
            expect.objectContaining({ clearIfOutside: true })
        );
        expect(view.state.field(tableDecorationField).decorations).toBe(decorationsAfterReplace);

        view.destroy();
    });

    describe('note switch', () => {
        /** Mirrors Joplin's switch: one transaction replaces the document and changes the note ID. */
        function switchNote(view: EditorView, params: { anchor: number; hadActiveCell: boolean }): void {
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: NOTE_SWITCH_DOC },
                selection: { anchor: params.anchor },
                effects: [
                    noteConfiguration.reconfigure(noteIdentityFacet.of('note-b')),
                    // The main editor guard adds this clear when a cell was active.
                    ...(params.hadActiveCell ? [clearActiveCellEffect.of(undefined)] : []),
                ],
            });
        }

        it('closes the open cell and moves the cursor out of a table without reopening a cell', () => {
            nestedEditorControllerMock.isNestedEditorOpen.mockReturnValue(true);
            const view = createLifecycleView({ doc: CANONICAL_DOC, activeCell: headerCell() });
            view.dispatch({ effects: openRequestEffects({ requestId: 'queued-open', activeCell: headerCell() }) });

            switchNote(view, { anchor: NOTE_SWITCH_POS_IN_TABLE, hadActiveCell: true });
            flushAnimationFrames();

            expect(nestedEditorControllerMock.closeNestedEditor).toHaveBeenCalledWith(view);
            expect(activateCellAtPositionMock).not.toHaveBeenCalled();
            expect(nestedEditorControllerMock.openNestedEditor).not.toHaveBeenCalled();
            expect(view.state.selection.main.head).toBe(NOTE_SWITCH_TABLE_TO + 1);
            expect(getActiveCell(view.state)).toBeNull();
            expect(getPendingOpenCellRequest(view.state)).toBeNull();

            view.destroy();
        });

        it('leaves a cursor outside every table where the switch put it', () => {
            nestedEditorControllerMock.isNestedEditorOpen.mockReturnValue(true);
            const view = createLifecycleView({ doc: CANONICAL_DOC, activeCell: headerCell() });

            switchNote(view, { anchor: NOTE_SWITCH_POS_OUTSIDE_TABLE, hadActiveCell: true });
            flushAnimationFrames();

            expect(activateCellAtPositionMock).not.toHaveBeenCalled();
            expect(view.state.selection.main.head).toBe(NOTE_SWITCH_POS_OUTSIDE_TABLE);
            expect(getActiveCell(view.state)).toBeNull();

            view.destroy();
        });

        it('moves the cursor out of a table when no cell was open', () => {
            const view = createLifecycleView({ doc: CANONICAL_DOC });

            switchNote(view, { anchor: NOTE_SWITCH_POS_IN_TABLE, hadActiveCell: false });
            flushAnimationFrames();

            expect(nestedEditorControllerMock.closeNestedEditor).not.toHaveBeenCalled();
            expect(activateCellAtPositionMock).not.toHaveBeenCalled();
            expect(view.state.selection.main.head).toBe(NOTE_SWITCH_TABLE_TO + 1);

            view.destroy();
        });

        it('keeps a selection the host restored after the switch', () => {
            const view = createLifecycleView({ doc: CANONICAL_DOC });

            switchNote(view, { anchor: NOTE_SWITCH_POS_IN_TABLE, hadActiveCell: false });
            view.dispatch({ selection: { anchor: NOTE_SWITCH_POS_OUTSIDE_TABLE } });
            flushAnimationFrames();

            expect(view.state.selection.main.head).toBe(NOTE_SWITCH_POS_OUTSIDE_TABLE);

            view.destroy();
        });
    });

    it('passes the pre-undo active cell as a fallback hint during undo or redo reactivation', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '| b1 | b2 |'].join('\n');
        const activeCell = headerCell({
            section: 'body',
            row: 1,
            col: 1,
        });
        const view = createLifecycleView({
            doc,
            activeCell,
        });

        view.dispatch({
            changes: {
                from: doc.indexOf('| b1 | b2 |'),
                to: doc.length,
                insert: '',
            },
            effects: clearActiveCellEffect.of(undefined),
            annotations: Transaction.userEvent.of('undo'),
            selection: { anchor: doc.indexOf('| a2') },
        });
        flushAnimationFrames();

        expect(activateCellAtPositionMock).toHaveBeenCalledWith(
            view,
            doc.indexOf('| a2'),
            expect.objectContaining({
                clearIfOutside: true,
                entryMode: 'enter',
                preferredActiveCell: activeCell,
            })
        );

        view.destroy();
    });

    it('maps the fallback hint when undo or redo shifts the table start before reactivation', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '| b1 | b2 |'].join('\n');
        const insertedPrefix = 'abc\n';
        const activeCell = headerCell({
            section: 'body',
            row: 1,
            col: 1,
        });
        const view = createLifecycleView({
            doc,
            activeCell,
        });

        view.dispatch({
            changes: { from: 0, to: 0, insert: insertedPrefix },
            effects: clearActiveCellEffect.of(undefined),
            annotations: Transaction.userEvent.of('redo'),
            selection: { anchor: insertedPrefix.length + doc.indexOf('| a2') },
        });
        flushAnimationFrames();

        expect(activateCellAtPositionMock).toHaveBeenCalledWith(
            view,
            insertedPrefix.length + doc.indexOf('| a2'),
            expect.objectContaining({
                clearIfOutside: true,
                entryMode: 'enter',
                preferredActiveCell: {
                    ...activeCell,
                    tableFrom: insertedPrefix.length,
                },
            })
        );

        view.destroy();
    });

    it('does not close the nested editor for a structural-edit signal without an explicit request', () => {
        nestedEditorControllerMock.isNestedEditorOpen.mockReturnValue(true);

        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const activeCell = headerCell();
        const view = createLifecycleView({
            doc,
            activeCell,
        });

        const nextActiveCell: ActiveCell = {
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 1,
        };

        view.dispatch({
            effects: [setActiveCellEffect.of(nextActiveCell), structuralTableEditEffect.of(undefined)],
        });

        expect(nestedEditorControllerMock.closeNestedEditor).not.toHaveBeenCalled();
        expect(nestedEditorControllerMock.openNestedEditor).not.toHaveBeenCalled();

        view.destroy();
    });

    it('opens the nested editor directly when no normalization is requested', () => {
        const doc = NON_CANONICAL_DOC;
        const activeCell = headerCell();
        const view = createLifecycleView({
            doc,
        });

        view.dispatch({
            effects: [
                setActiveCellEffect.of(activeCell),
                ...openRequestEffects({
                    requestId: 'request-direct',
                    activeCell,
                    initialCursorPos: 'end',
                }),
            ],
        });
        flushAnimationFrames();

        expect(view.state.doc.toString()).toBe(NON_CANONICAL_DOC);
        expect(nestedEditorControllerMock.openNestedEditor).toHaveBeenCalledWith(
            expect.objectContaining({
                mainView: view,
                resolvedCell: expect.objectContaining({ activeCell }),
                featureSettings: DEFAULT_FEATURE_SETTINGS,
                initialCursorPos: 'end',
            })
        );
        expect(getPendingOpenCellRequest(view.state)).toBeNull();

        view.destroy();
    });

    it('uses the latest open request when one dispatch contains multiple trigger effects', () => {
        const activeCell = headerCell();
        const view = createLifecycleView({
            doc: CANONICAL_DOC,
        });

        view.dispatch({
            effects: [
                setActiveCellEffect.of(activeCell),
                ...openRequestEffects({
                    requestId: 'request-stale',
                    activeCell,
                    initialCursorPos: 'start',
                }),
                ...openRequestEffects({
                    requestId: 'request-latest',
                    activeCell,
                    initialCursorPos: 'end',
                }),
            ],
        });
        flushAnimationFrames();

        expect(nestedEditorControllerMock.openNestedEditor).toHaveBeenCalledWith(
            expect.objectContaining({
                mainView: view,
                featureSettings: DEFAULT_FEATURE_SETTINGS,
                initialCursorPos: 'end',
            })
        );
        expect(getPendingOpenCellRequest(view.state)).toBeNull();

        view.destroy();
    });

    it('fails the matching request when the cell element cannot be found', () => {
        findCellElementMock.mockReturnValueOnce(null);
        const doc = CANONICAL_DOC;
        const activeCell = headerCell();
        const view = createLifecycleView({
            doc,
        });

        view.dispatch({
            effects: [
                setActiveCellEffect.of(activeCell),
                ...openRequestEffects({
                    requestId: 'request-missing-cell',
                    activeCell,
                }),
            ],
        });
        flushAnimationFrames();

        expect(nestedEditorControllerMock.openNestedEditor).not.toHaveBeenCalled();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();

        view.destroy();
    });

    it('fails the request and clears the active cell when it no longer resolves to a table', () => {
        // The anchor sits in the paragraph, so no table starts there.
        const activeCell = headerCell({ tableFrom: 1 });
        const view = createLifecycleView({
            doc: `intro\n\n${CANONICAL_DOC}`,
        });

        view.dispatch({
            effects: [
                setActiveCellEffect.of(activeCell),
                ...openRequestEffects({
                    requestId: 'request-unresolved',
                    activeCell,
                }),
            ],
        });
        flushAnimationFrames();

        expect(nestedEditorControllerMock.openNestedEditor).not.toHaveBeenCalled();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
        expect(getActiveCell(view.state)).toBeNull();

        view.destroy();
    });

    it('ignores a request-open signal when the pending request is missing', () => {
        const view = createLifecycleView({
            doc: CANONICAL_DOC,
        });

        view.dispatch({
            effects: triggerOpenCellRequestEffect.of({ requestId: 'missing-request' }),
        });
        flushAnimationFrames();

        expect(nestedEditorControllerMock.openNestedEditor).not.toHaveBeenCalled();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();

        view.destroy();
    });

    it('opens a requested cell without repairing the document itself', () => {
        // Entry transactions carry whatever repair the table needs, so nothing here may
        // rewrite the document a frame later: the host cannot order a late rewrite against
        // the keystrokes around it and writes a stale note body back over the editor.
        const activeCell = headerCell({
            section: 'header',
            row: 0,
            col: 1,
        });
        const view = createLifecycleView({
            doc: NON_CANONICAL_DOC,
        });

        view.dispatch({
            effects: [
                setActiveCellEffect.of(activeCell),
                ...openRequestEffects({
                    requestId: 'request-no-repair',
                    activeCell,
                    initialCursorPos: 'end',
                }),
            ],
        });
        flushAnimationFrames();

        expect(view.state.doc.toString()).toBe(NON_CANONICAL_DOC);
        expect(nestedEditorControllerMock.openNestedEditor).toHaveBeenCalledWith(
            expect.objectContaining({
                mainView: view,
                featureSettings: DEFAULT_FEATURE_SETTINGS,
                initialCursorPos: 'end',
            })
        );
        expect(getPendingOpenCellRequest(view.state)).toBeNull();

        view.destroy();
    });

    it('opens using the remapped request state when the document shifts before the RAF callback', () => {
        const activeCell = headerCell();
        const insertedPrefix = 'before\n\n';

        const view = createLifecycleView({
            doc: CANONICAL_DOC,
        });

        view.dispatch({
            effects: [
                setActiveCellEffect.of(activeCell),
                ...openRequestEffects({
                    requestId: 'request-remapped-before-open',
                    activeCell,
                }),
            ],
        });

        view.dispatch({
            changes: { from: 0, to: 0, insert: insertedPrefix },
        });

        flushAnimationFrames();

        expect(nestedEditorControllerMock.openNestedEditor).toHaveBeenCalledWith(
            expect.objectContaining({
                mainView: view,
                featureSettings: DEFAULT_FEATURE_SETTINGS,
            })
        );
        expect(getPendingOpenCellRequest(view.state)).toBeNull();

        view.destroy();
    });

    it('preserves the raw-mode text selection when exiting source mode into a nested editor', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const selectionFrom = doc.indexOf('H1');
        const selectionTo = selectionFrom + 'H1'.length;

        let state = createLifecycleState({
            doc,
        });
        state = state.update({
            effects: toggleSourceModeEffect.of(true),
            selection: { anchor: selectionFrom, head: selectionTo },
        }).state;
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({ parent, state });
        vi.spyOn(view, 'coordsAtPos').mockReturnValue({
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
        });

        view.dispatch({
            effects: [toggleSourceModeEffect.of(false), exitSourceModeEffect.of(undefined)],
        });
        flushAnimationFrames();

        expect(view.state.selection.main.anchor).toBe(selectionFrom);
        expect(view.state.selection.main.head).toBe(selectionTo);

        view.destroy();
    });

    it('rejects a stale active-cell anchor when exiting source mode', () => {
        const doc = CANONICAL_DOC;
        let state = createLifecycleState({
            doc,
            activeCell: headerCell({ tableFrom: doc.length + 1 }),
        });
        state = state.update({ effects: toggleSourceModeEffect.of(true) }).state;
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({ parent, state });

        expect(() =>
            view.dispatch({
                effects: [toggleSourceModeEffect.of(false), exitSourceModeEffect.of(undefined)],
            })
        ).not.toThrow();
        flushAnimationFrames();

        expect(activateCellAtPositionMock).toHaveBeenCalledWith(
            view,
            view.state.selection.main.head,
            expect.objectContaining({ preferredActiveCell: null })
        );

        view.destroy();
    });

    it('closes and clears the active cell when main-editor selection leaves the active table', () => {
        nestedEditorControllerMock.isNestedEditorOpen.mockReturnValue(true);

        const prefixedDoc = ['before', '', '| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '', 'after'].join('\n');
        const tableFrom = 'before\n\n'.length;
        const activeCell = headerCell({
            tableFrom,
        });
        const view = createLifecycleView({
            doc: prefixedDoc,
            selection: { anchor: tableFrom + 2 },
            activeCell,
        });

        const resolved = resolveActiveCell(view.state, activeCell);
        if (!resolved) {
            throw new Error('Expected the active cell to resolve');
        }

        view.dispatch({
            selection: { anchor: 0 },
        });
        flushAnimationFrames();

        expect(nestedEditorControllerMock.closeNestedEditor).toHaveBeenNthCalledWith(1, view, {
            contentFrom: resolved.contentFrom,
            contentTo: resolved.contentTo,
        });
        expect(getActiveCell(view.state)).toBeNull();

        view.destroy();
    });

    it('closes with the shifted cell range when an edit before the table also moves selection out', () => {
        nestedEditorControllerMock.isNestedEditorOpen.mockReturnValue(true);

        const prefixedDoc = ['before', '', '| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '', 'after'].join('\n');
        const tableFrom = 'before\n\n'.length;
        const insertedText = 'top\n';
        const view = createLifecycleView({
            doc: prefixedDoc,
            selection: { anchor: tableFrom + 2 },
            activeCell: headerCell({ tableFrom }),
        });

        // One transaction that shifts the table without touching it and leaves the table:
        // the active host is preserved, so the cell's widget stays mounted.
        view.dispatch({
            changes: { from: 0, to: 0, insert: insertedText },
            selection: { anchor: 0 },
        });

        const closeParams = nestedEditorControllerMock.closeNestedEditor.mock.calls[0]?.[1] as
            { contentFrom: number; contentTo: number } | undefined;
        expect(closeParams).toBeDefined();
        if (!closeParams) {
            throw new Error('Expected the close to carry a cell range');
        }
        expect(closeParams.contentFrom).toBe(tableFrom + insertedText.length + '| '.length);
        expect(view.state.doc.sliceString(closeParams.contentFrom, closeParams.contentTo)).toBe('H1');

        flushAnimationFrames();
        expect(getActiveCell(view.state)).toBeNull();

        view.destroy();
    });

    it('keeps the pending reopen when selection leaves the table after a structural close', () => {
        nestedEditorControllerMock.isNestedEditorOpen.mockReturnValueOnce(true).mockReturnValue(false);

        const originalTable = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const updatedTable = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '|  |  |'].join('\n');
        const prefixedDoc = ['before', '', originalTable, '', 'after'].join('\n');
        const tableFrom = 'before\n\n'.length;
        const tableTo = tableFrom + originalTable.length;
        const currentCell = headerCell({
            tableFrom,
            section: 'body',
            row: 0,
            col: 1,
        });
        const nextCell = createActiveCellForTable({
            tableFrom,
            serialized: parseTableFixture(updatedTable).serializeWithOffsets(),
            target: { section: 'body', row: 1, col: 1 },
        })?.activeCell;
        expect(nextCell).not.toBeNull();
        if (!nextCell) {
            throw new Error('Expected next active cell after structural edit');
        }

        const view = createLifecycleView({
            doc: prefixedDoc,
            selection: { anchor: tableFrom + originalTable.indexOf('a2') },
            activeCell: currentCell,
        });

        view.dispatch({
            changes: { from: tableFrom, to: tableTo, insert: updatedTable },
            effects: [
                setActiveCellEffect.of(nextCell),
                structuralTableEditEffect.of(undefined),
                ...openRequestEffects({
                    requestId: 'request-structural-reopen',
                    activeCell: nextCell,
                }),
            ],
        });

        view.dispatch({
            selection: { anchor: 0 },
        });

        flushAnimationFrames();

        expect(getActiveCell(view.state)).toEqual(nextCell);
        expect(nestedEditorControllerMock.openNestedEditor).toHaveBeenCalledWith(
            expect.objectContaining({
                mainView: view,
                featureSettings: DEFAULT_FEATURE_SETTINGS,
            })
        );

        view.destroy();
    });
});

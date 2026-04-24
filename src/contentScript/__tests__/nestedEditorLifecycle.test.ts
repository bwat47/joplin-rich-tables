/**
 * @jest-environment jsdom
 */

import { EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { nestedEditorLifecyclePlugin } from '../tableRuntime/lifecycle/nestedEditorLifecycle';
import { activateInsertedTableEffect } from '../tableState/insertedTableActivation';
import {
    activeCellField,
    clearActiveCellEffect,
    getActiveCell,
    setActiveCellEffect,
    type ActiveCell,
} from '../tableState/activeCellState';
import { searchForceSourceModeField } from '../tableState/searchForceSourceMode';
import { exitSourceModeEffect, sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { resolveActiveCell } from '../tableRuntime/activeCell/activeCellResolver';
import { requestOpenActiveCellEffect } from '../tableRuntime/activeCell/activeCellOpen';
import {
    beginOpenCellRequestEffect,
    getPendingOpenCellRequest,
    openCellRequestField,
    type OpenCellRequest,
} from '../tableRuntime/openCellRequest';
import type { NestedEditorFeatureSettings } from '../../contentScriptBridge/editorSettingsBridge';
import { createActiveCellForTableText } from '../tableRuntime/activeCell/activeCellFactory';

const activateCellAtPositionMock = jest.fn();
const activateTableCellMock = jest.fn();
const findCellElementMock: jest.Mock = jest.fn(() => document.createElement('td'));
const DEFAULT_FEATURE_SETTINGS = {
    autoMatchingBraces: true,
} satisfies NestedEditorFeatureSettings;
const getNestedEditorFeatureSettingsMock = jest.fn(() => DEFAULT_FEATURE_SETTINGS);
const nestedEditorControllerMock = jest.requireMock('../nestedEditor/nestedEditorController') as {
    closeNestedEditor: jest.Mock;
    isNestedEditorOpen: jest.Mock;
    openNestedEditor: jest.Mock;
};
const NON_CANONICAL_DOC = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');
const CANONICAL_DOC = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');

function openRequestEffects(params: {
    requestId: string;
    activeCell: ActiveCell;
    normalizeIfNeeded: boolean;
    initialCursorPos?: 'start' | 'end' | 'lastLineStart';
}) {
    const request: OpenCellRequest = {
        requestId: params.requestId,
        activeCell: params.activeCell,
        normalizeIfNeeded: params.normalizeIfNeeded,
        initialCursorPos: params.initialCursorPos,
        suppressKeys: false,
    };

    return [
        beginOpenCellRequestEffect.of(request),
        requestOpenActiveCellEffect.of({
            requestId: params.requestId,
        }),
    ];
}

jest.mock('../tableRuntime/activeCell/cellActivation', () => ({
    activateCellAtPosition: (...args: unknown[]) => activateCellAtPositionMock(...args),
    activateTableCell: (...args: unknown[]) => activateTableCellMock(...args),
}));

jest.mock('../tableWidget/domHelpers', () => ({
    findCellElement: (view: unknown, tableId: unknown, activeCell: unknown) =>
        findCellElementMock(view, tableId, activeCell),
}));

jest.mock('../nestedEditor/nestedEditorController', () => ({
    closeNestedEditor: jest.fn(),
    handleMainEditorUpdate: jest.fn(),
    isNestedEditorOpen: jest.fn(() => false),
    openNestedEditor: jest.fn(),
}));

jest.mock('../services/nestedEditorFeatureSettings', () => ({
    getNestedEditorFeatureSettings: () => getNestedEditorFeatureSettingsMock(),
}));

describe('nestedEditorLifecycle', () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
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
        getNestedEditorFeatureSettingsMock.mockReset();
        getNestedEditorFeatureSettingsMock.mockImplementation(() => DEFAULT_FEATURE_SETTINGS);
        nestedEditorControllerMock.closeNestedEditor.mockReset();
        nestedEditorControllerMock.isNestedEditorOpen.mockReset();
        nestedEditorControllerMock.openNestedEditor.mockReset();
        nestedEditorControllerMock.openNestedEditor.mockReturnValue(true);
        nestedEditorControllerMock.isNestedEditorOpen.mockReturnValue(false);
        animationFrameQueue = [];
        globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
            animationFrameQueue.push(callback);
            return animationFrameQueue.length;
        }) as typeof requestAnimationFrame;
    });

    afterEach(() => {
        globalThis.requestAnimationFrame = originalRequestAnimationFrame;
        document.body.innerHTML = '';
    });

    it('schedules inserted-table activation from the effect payload', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        const view = new EditorView({
            parent,
            state: EditorState.create({
                doc: '',
                extensions: [
                    markdown({ extensions: [GFM] }),
                    activeCellField,
                    openCellRequestField,
                    searchForceSourceModeField,
                    sourceModeField,
                    nestedEditorLifecyclePlugin,
                ],
            }),
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

    it('passes the mapped cell range when undo or redo closes the nested editor', () => {
        nestedEditorControllerMock.isNestedEditorOpen.mockReturnValue(true);

        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const activeCell: ActiveCell = {
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 0,
        };

        let state = EditorState.create({
            doc,
            extensions: [
                markdown({ extensions: [GFM] }),
                activeCellField,
                openCellRequestField,
                searchForceSourceModeField,
                sourceModeField,
                nestedEditorLifecyclePlugin,
            ],
        });
        state = state.update({ effects: setActiveCellEffect.of(activeCell) }).state;

        const parent = document.createElement('div');
        const view = new EditorView({ parent, state });

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

    it('passes the pre-undo active cell as a fallback hint during undo or redo reactivation', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '| b1 | b2 |'].join('\n');
        const activeCell: ActiveCell = {
            tableFrom: 0,
            section: 'body',
            row: 1,
            col: 1,
        };

        let state = EditorState.create({
            doc,
            extensions: [
                markdown({ extensions: [GFM] }),
                activeCellField,
                openCellRequestField,
                searchForceSourceModeField,
                sourceModeField,
                nestedEditorLifecyclePlugin,
            ],
        });
        state = state.update({ effects: setActiveCellEffect.of(activeCell) }).state;

        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({ parent, state });

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
                normalizeIfNeeded: false,
                preserveMainSelection: false,
                preferredActiveCell: activeCell,
            })
        );

        view.destroy();
    });

    it('maps the fallback hint when undo or redo shifts the table start before reactivation', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '| b1 | b2 |'].join('\n');
        const insertedPrefix = 'abc\n';
        const activeCell: ActiveCell = {
            tableFrom: 0,
            section: 'body',
            row: 1,
            col: 1,
        };

        let state = EditorState.create({
            doc,
            extensions: [
                markdown({ extensions: [GFM] }),
                activeCellField,
                openCellRequestField,
                searchForceSourceModeField,
                sourceModeField,
                nestedEditorLifecyclePlugin,
            ],
        });
        state = state.update({ effects: setActiveCellEffect.of(activeCell) }).state;

        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({ parent, state });

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
                normalizeIfNeeded: false,
                preserveMainSelection: false,
                preferredActiveCell: {
                    ...activeCell,
                    tableFrom: insertedPrefix.length,
                },
            })
        );

        view.destroy();
    });

    it('does not close the nested editor for rebuild-only active-cell changes without an explicit request', () => {
        nestedEditorControllerMock.isNestedEditorOpen.mockReturnValue(true);

        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const activeCell: ActiveCell = {
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 0,
        };

        let state = EditorState.create({
            doc,
            extensions: [
                markdown({ extensions: [GFM] }),
                activeCellField,
                openCellRequestField,
                searchForceSourceModeField,
                sourceModeField,
                nestedEditorLifecyclePlugin,
            ],
        });
        state = state.update({ effects: setActiveCellEffect.of(activeCell) }).state;

        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({ parent, state });

        const nextActiveCell: ActiveCell = {
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 1,
        };

        view.dispatch({
            effects: [
                setActiveCellEffect.of(nextActiveCell),
                rebuildTableWidgetsEffect.of({ tableFrom: nextActiveCell.tableFrom }),
            ],
        });

        expect(nestedEditorControllerMock.closeNestedEditor).not.toHaveBeenCalled();
        expect(nestedEditorControllerMock.openNestedEditor).not.toHaveBeenCalled();

        view.destroy();
    });

    it('opens the nested editor directly when no normalization is requested', () => {
        const doc = NON_CANONICAL_DOC;
        const activeCell: ActiveCell = {
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 0,
        };

        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({
            parent,
            state: EditorState.create({
                doc,
                extensions: [
                    markdown({ extensions: [GFM] }),
                    activeCellField,
                    openCellRequestField,
                    searchForceSourceModeField,
                    sourceModeField,
                    nestedEditorLifecyclePlugin,
                ],
            }),
        });

        view.dispatch({
            effects: [
                setActiveCellEffect.of(activeCell),
                ...openRequestEffects({
                    requestId: 'request-direct',
                    activeCell,
                    normalizeIfNeeded: false,
                    initialCursorPos: 'end',
                }),
            ],
        });
        flushAnimationFrames();

        expect(view.state.doc.toString()).toBe(NON_CANONICAL_DOC);
        expect(nestedEditorControllerMock.openNestedEditor).toHaveBeenCalledWith(
            expect.objectContaining({
                mainView: view,
                activeCell,
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
        const activeCell: ActiveCell = {
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 0,
        };

        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({
            parent,
            state: EditorState.create({
                doc,
                extensions: [
                    markdown({ extensions: [GFM] }),
                    activeCellField,
                    openCellRequestField,
                    searchForceSourceModeField,
                    sourceModeField,
                    nestedEditorLifecyclePlugin,
                ],
            }),
        });

        view.dispatch({
            effects: [
                setActiveCellEffect.of(activeCell),
                ...openRequestEffects({
                    requestId: 'request-missing-cell',
                    activeCell,
                    normalizeIfNeeded: false,
                }),
            ],
        });
        flushAnimationFrames();

        expect(nestedEditorControllerMock.openNestedEditor).not.toHaveBeenCalled();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();

        view.destroy();
    });

    it('ignores a request-open signal when the pending request is missing', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({
            parent,
            state: EditorState.create({
                doc: CANONICAL_DOC,
                extensions: [
                    markdown({ extensions: [GFM] }),
                    activeCellField,
                    openCellRequestField,
                    searchForceSourceModeField,
                    sourceModeField,
                    nestedEditorLifecyclePlugin,
                ],
            }),
        });

        view.dispatch({
            effects: requestOpenActiveCellEffect.of({ requestId: 'missing-request' }),
        });
        flushAnimationFrames();

        expect(nestedEditorControllerMock.openNestedEditor).not.toHaveBeenCalled();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();

        view.destroy();
    });

    it('normalizes before opening and preserves pending cursor placement', () => {
        const activeCell: ActiveCell = {
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 1,
        };

        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({
            parent,
            state: EditorState.create({
                doc: NON_CANONICAL_DOC,
                extensions: [
                    markdown({ extensions: [GFM] }),
                    activeCellField,
                    openCellRequestField,
                    searchForceSourceModeField,
                    sourceModeField,
                    nestedEditorLifecyclePlugin,
                ],
            }),
        });
        const dispatchSpy = jest.spyOn(view, 'dispatch');

        view.dispatch({
            effects: [
                setActiveCellEffect.of(activeCell),
                ...openRequestEffects({
                    requestId: 'request-normalize',
                    activeCell,
                    normalizeIfNeeded: true,
                    initialCursorPos: 'end',
                }),
            ],
        });
        flushAnimationFrames();

        expect(view.state.doc.toString()).toBe(CANONICAL_DOC);

        const normalizedOpenDispatch = dispatchSpy.mock.calls
            .map((call) => call[0])
            .find((spec) => {
                const effects = Array.isArray(spec?.effects) ? spec.effects : [spec?.effects];
                return (
                    effects.some(
                        (effect) =>
                            effect?.is?.(beginOpenCellRequestEffect) &&
                            effect.value?.requestId === 'request-normalize' &&
                            effect.value?.normalizeIfNeeded === false
                    ) &&
                    effects.some(
                        (effect) =>
                            effect?.is?.(requestOpenActiveCellEffect) && effect.value?.requestId === 'request-normalize'
                    )
                );
            });

        expect(normalizedOpenDispatch).toBeDefined();
        expect(nestedEditorControllerMock.openNestedEditor).toHaveBeenCalledWith(
            expect.objectContaining({
                mainView: view,
                activeCell: {
                    tableFrom: 0,
                    section: 'header',
                    row: 0,
                    col: 1,
                },
                featureSettings: DEFAULT_FEATURE_SETTINGS,
                initialCursorPos: 'end',
            })
        );
        expect(getPendingOpenCellRequest(view.state)).toBeNull();

        view.destroy();
    });

    it('opens using the remapped request state when the document shifts before the RAF callback', () => {
        const activeCell: ActiveCell = {
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 0,
        };
        const insertedPrefix = 'before\n\n';

        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({
            parent,
            state: EditorState.create({
                doc: CANONICAL_DOC,
                extensions: [
                    markdown({ extensions: [GFM] }),
                    activeCellField,
                    openCellRequestField,
                    searchForceSourceModeField,
                    sourceModeField,
                    nestedEditorLifecyclePlugin,
                ],
            }),
        });

        view.dispatch({
            effects: [
                setActiveCellEffect.of(activeCell),
                ...openRequestEffects({
                    requestId: 'request-remapped-before-open',
                    activeCell,
                    normalizeIfNeeded: false,
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
                activeCell: {
                    ...activeCell,
                    tableFrom: insertedPrefix.length,
                },
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

        const parent = document.createElement('div');
        document.body.appendChild(parent);
        let state = EditorState.create({
            doc,
            extensions: [
                markdown({ extensions: [GFM] }),
                activeCellField,
                openCellRequestField,
                searchForceSourceModeField,
                sourceModeField,
                nestedEditorLifecyclePlugin,
            ],
        });
        state = state.update({
            effects: toggleSourceModeEffect.of(true),
            selection: { anchor: selectionFrom, head: selectionTo },
        }).state;
        const view = new EditorView({
            parent,
            state,
        });
        jest.spyOn(view, 'coordsAtPos').mockReturnValue({
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

    it('closes and clears the active cell when main-editor selection leaves the active table', () => {
        nestedEditorControllerMock.isNestedEditorOpen.mockReturnValue(true);

        const prefixedDoc = ['before', '', '| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '', 'after'].join('\n');
        const tableFrom = 'before\n\n'.length;
        const activeCell: ActiveCell = {
            tableFrom,
            section: 'header',
            row: 0,
            col: 0,
        };

        let state = EditorState.create({
            doc: prefixedDoc,
            extensions: [
                markdown({ extensions: [GFM] }),
                activeCellField,
                openCellRequestField,
                searchForceSourceModeField,
                sourceModeField,
                nestedEditorLifecyclePlugin,
            ],
        });
        state = state.update({
            effects: setActiveCellEffect.of(activeCell),
            selection: { anchor: tableFrom + 2 },
        }).state;

        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({ parent, state });

        view.dispatch({
            selection: { anchor: 0 },
        });
        flushAnimationFrames();

        expect(nestedEditorControllerMock.closeNestedEditor).toHaveBeenCalledWith(view);
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
        const currentCell: ActiveCell = {
            tableFrom,
            section: 'body',
            row: 0,
            col: 1,
        };
        const nextCell = createActiveCellForTableText({
            tableFrom,
            tableText: updatedTable,
            target: { section: 'body', row: 1, col: 1 },
        })?.activeCell;
        expect(nextCell).not.toBeNull();
        if (!nextCell) {
            throw new Error('Expected next active cell after structural edit');
        }

        let state = EditorState.create({
            doc: prefixedDoc,
            extensions: [
                markdown({ extensions: [GFM] }),
                activeCellField,
                openCellRequestField,
                searchForceSourceModeField,
                sourceModeField,
                nestedEditorLifecyclePlugin,
            ],
        });
        state = state.update({
            effects: setActiveCellEffect.of(currentCell),
            selection: { anchor: tableFrom + originalTable.indexOf('a2') },
        }).state;

        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({ parent, state });

        view.dispatch({
            changes: { from: tableFrom, to: tableTo, insert: updatedTable },
            effects: [
                setActiveCellEffect.of(nextCell),
                rebuildTableWidgetsEffect.of({ tableFrom }),
                ...openRequestEffects({
                    requestId: 'request-structural-reopen',
                    activeCell: nextCell,
                    normalizeIfNeeded: false,
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
                activeCell: nextCell,
                featureSettings: DEFAULT_FEATURE_SETTINGS,
            })
        );

        view.destroy();
    });
});

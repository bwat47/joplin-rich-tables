/**
 * @jest-environment jsdom
 */

import { EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { nestedEditorLifecyclePlugin } from '../tableRuntime/lifecycle/nestedEditorLifecycle';
import { activateInsertedTableEffect } from '../tableState/insertedTableActivation';
import { activeCellField, getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { searchForceSourceModeField } from '../tableState/searchForceSourceMode';
import { exitSourceModeEffect, sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { resolveActiveCell } from '../tableRuntime/activeCell/activeCellResolver';
import { requestOpenActiveCellEffect } from '../tableRuntime/activeCell/activeCellOpen';
import { rememberPendingCellOpen } from '../nestedEditor/pendingCellOpen';
import type { NestedEditorFeatureSettings } from '../../contentScriptBridge/editorSettingsBridge';

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

jest.mock('../tableRuntime/activeCell/cellActivation', () => ({
    activateCellAtPosition: jest.fn(),
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

jest.mock('../services/nestedEditorFeatureSettingsService', () => ({
    getNestedEditorFeatureSettings: () => getNestedEditorFeatureSettingsMock(),
}));

describe('nestedEditorLifecycle', () => {
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    let animationFrameQueue: FrameRequestCallback[] = [];

    const flushAnimationFrames = (): void => {
        while (animationFrameQueue.length > 0) {
            const callback = animationFrameQueue.shift();
            callback?.(0);
        }
    };

    beforeEach(() => {
        activateTableCellMock.mockReset();
        findCellElementMock.mockClear();
        getNestedEditorFeatureSettingsMock.mockReset();
        getNestedEditorFeatureSettingsMock.mockImplementation(() => DEFAULT_FEATURE_SETTINGS);
        nestedEditorControllerMock.closeNestedEditor.mockReset();
        nestedEditorControllerMock.isNestedEditorOpen.mockReset();
        nestedEditorControllerMock.openNestedEditor.mockReset();
        nestedEditorControllerMock.isNestedEditorOpen.mockReturnValue(false);
        animationFrameQueue = [];
        global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
            animationFrameQueue.push(callback);
            return animationFrameQueue.length;
        }) as typeof requestAnimationFrame;
    });

    afterEach(() => {
        global.requestAnimationFrame = originalRequestAnimationFrame;
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
            cellFrom: resolved.cellFrom,
            cellTo: resolved.cellTo,
        });

        view.destroy();
    });

    it('does not pass a resolved range when force rebuild closes the nested editor', () => {
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

        expect(nestedEditorControllerMock.closeNestedEditor).toHaveBeenCalledWith(view);

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
                    searchForceSourceModeField,
                    sourceModeField,
                    nestedEditorLifecyclePlugin,
                ],
            }),
        });

        rememberPendingCellOpen(view, activeCell, { initialCursorPos: 'end' });

        view.dispatch({
            effects: [
                setActiveCellEffect.of(activeCell),
                requestOpenActiveCellEffect.of({
                    activeCell,
                    normalizeIfNeeded: false,
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
                    searchForceSourceModeField,
                    sourceModeField,
                    nestedEditorLifecyclePlugin,
                ],
            }),
        });
        const dispatchSpy = jest.spyOn(view, 'dispatch');

        rememberPendingCellOpen(view, activeCell, { initialCursorPos: 'end' });

        view.dispatch({
            effects: [
                setActiveCellEffect.of(activeCell),
                requestOpenActiveCellEffect.of({
                    activeCell,
                    normalizeIfNeeded: true,
                }),
            ],
        });
        flushAnimationFrames();

        expect(view.state.doc.toString()).toBe(CANONICAL_DOC);

        const normalizedOpenDispatch = dispatchSpy.mock.calls
            .map((call) => call[0])
            .find((spec) => {
                const effects = Array.isArray(spec?.effects) ? spec.effects : [spec?.effects];
                return effects.some(
                    (effect) => effect?.is?.(requestOpenActiveCellEffect) && effect.value?.normalizeIfNeeded === false
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
});

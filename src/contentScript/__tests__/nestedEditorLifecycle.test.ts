/**
 * @jest-environment jsdom
 */

import { EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { nestedEditorLifecyclePlugin } from '../tableRuntime/nestedEditorLifecycle';
import { activateInsertedTableEffect } from '../tableState/insertedTableActivation';
import { activeCellField, getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { searchForceSourceModeField } from '../tableState/searchForceSourceMode';
import { exitSourceModeEffect, sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { resolveActiveCell } from '../tableRuntime/activeCellResolver';
import { requestOpenActiveCellEffect } from '../tableRuntime/activeCellOpen';
import { rememberPendingCellOpen } from '../nestedEditor/pendingCellOpen';

const activateTableCellMock = jest.fn();
const findCellElementMock: jest.Mock = jest.fn(() => document.createElement('td'));
const nestedCellEditorMock = jest.requireMock('../nestedEditor/nestedCellEditor') as {
    closeNestedCellEditor: jest.Mock;
    isNestedCellEditorOpen: jest.Mock;
    openNestedCellEditor: jest.Mock;
};

jest.mock('../tableRuntime/cellActivation', () => ({
    activateCellAtPosition: jest.fn(),
    activateTableCell: (...args: unknown[]) => activateTableCellMock(...args),
}));

jest.mock('../tableWidget/domHelpers', () => ({
    findCellElement: (view: unknown, tableId: unknown, activeCell: unknown) =>
        findCellElementMock(view, tableId, activeCell),
}));

jest.mock('../nestedEditor/nestedCellEditor', () => ({
    closeNestedCellEditor: jest.fn(),
    handleMainEditorUpdateForNestedEditor: jest.fn(),
    isNestedCellEditorOpen: jest.fn(() => false),
    openNestedCellEditor: jest.fn(),
}));

describe('nestedEditorLifecycle', () => {
    const originalRequestAnimationFrame = global.requestAnimationFrame;

    beforeEach(() => {
        activateTableCellMock.mockReset();
        findCellElementMock.mockClear();
        nestedCellEditorMock.closeNestedCellEditor.mockReset();
        nestedCellEditorMock.isNestedCellEditorOpen.mockReset();
        nestedCellEditorMock.openNestedCellEditor.mockReset();
        nestedCellEditorMock.isNestedCellEditorOpen.mockReturnValue(false);
        global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
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

        expect(activateTableCellMock).toHaveBeenCalledWith(view, 42, {
            section: 'header',
            row: 0,
            col: 0,
        });

        view.destroy();
    });

    it('passes the mapped cell range when undo or redo closes the nested editor', () => {
        nestedCellEditorMock.isNestedCellEditorOpen.mockReturnValue(true);

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

        expect(nestedCellEditorMock.closeNestedCellEditor).toHaveBeenCalledWith(view, {
            cellFrom: resolved.cellFrom,
            cellTo: resolved.cellTo,
        });

        view.destroy();
    });

    it('does not pass a resolved range when force rebuild closes the nested editor', () => {
        nestedCellEditorMock.isNestedCellEditorOpen.mockReturnValue(true);

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

        expect(nestedCellEditorMock.closeNestedCellEditor).toHaveBeenCalledWith(view);

        view.destroy();
    });

    it('opens the nested editor only when an open request effect is dispatched', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
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

        expect(nestedCellEditorMock.openNestedCellEditor).toHaveBeenCalledWith(
            expect.objectContaining({
                mainView: view,
                activeCell,
                normalizeIfNeeded: false,
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

        expect(view.state.selection.main.anchor).toBe(selectionFrom);
        expect(view.state.selection.main.head).toBe(selectionTo);

        view.destroy();
    });
});

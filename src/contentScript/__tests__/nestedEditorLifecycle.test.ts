/**
 * @jest-environment jsdom
 */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { nestedEditorLifecyclePlugin } from '../tableRuntime/nestedEditorLifecycle';
import { activateInsertedTableEffect } from '../tableState/insertedTableActivation';
import { activeCellField } from '../tableState/activeCellState';
import { searchForceSourceModeField } from '../tableState/searchForceSourceMode';
import { sourceModeField } from '../tableState/sourceMode';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';

const activateTableCellMock = jest.fn();

jest.mock('../tableRuntime/cellActivation', () => ({
    activateCellAtPosition: jest.fn(),
    activateTableCell: (...args: unknown[]) => activateTableCellMock(...args),
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
});

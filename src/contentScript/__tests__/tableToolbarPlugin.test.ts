/**
 * @jest-environment jsdom
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { EditorView } from '@codemirror/view';
import type { ActiveCell } from '../tableState/activeCellState';

const mockInsertRowAbove = jest.fn();
const mockInsertRowBelow = jest.fn();
const mockInsertColumnLeft = jest.fn();
const mockInsertColumnRight = jest.fn();
const mockDeleteRow = jest.fn();
const mockDeleteColumn = jest.fn();
const mockUpdateAlignment = jest.fn();
const mockClearRow = jest.fn();
const mockClearColumn = jest.fn();
const mockClearTable = jest.fn();
const mockDeleteTable = jest.fn();
const mockMoveRowUp = jest.fn();
const mockMoveRowDown = jest.fn();
const mockMoveColumnLeft = jest.fn();
const mockMoveColumnRight = jest.fn();
const mockIsNestedEditorOpen = jest.fn();
const mockRefocusNestedEditor = jest.fn();

jest.mock('../tableRuntime/operations/structuralOperations', () => ({
    insertRowAbove: mockInsertRowAbove,
    insertRowBelow: mockInsertRowBelow,
    insertColumnLeft: mockInsertColumnLeft,
    insertColumnRight: mockInsertColumnRight,
    deleteRow: mockDeleteRow,
    deleteColumn: mockDeleteColumn,
    updateAlignment: mockUpdateAlignment,
    clearRow: mockClearRow,
    clearColumn: mockClearColumn,
    clearTable: mockClearTable,
    deleteTable: mockDeleteTable,
    moveRowUp: mockMoveRowUp,
    moveRowDown: mockMoveRowDown,
    moveColumnLeft: mockMoveColumnLeft,
    moveColumnRight: mockMoveColumnRight,
}));

jest.mock('../nestedEditor/nestedEditorController', () => ({
    isNestedEditorOpen: mockIsNestedEditorOpen,
    refocusNestedEditor: mockRefocusNestedEditor,
}));

import { TableToolbarPlugin } from '../toolbar/tableToolbarPlugin';

function createCell(): ActiveCell {
    return {
        tableFrom: 12,
        section: 'body',
        row: 0,
        col: 1,
    };
}

function createView(): EditorView {
    const dom = document.createElement('div');
    document.body.appendChild(dom);
    return { dom } as unknown as EditorView;
}

function getToolbarButton(plugin: TableToolbarPlugin, ariaLabel: string): HTMLButtonElement {
    const button = plugin.dom.querySelector(`button[aria-label="${ariaLabel}"]`);
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing toolbar button: ${ariaLabel}`);
    }

    return button;
}

function setCurrentActiveCell(plugin: TableToolbarPlugin, cell: ActiveCell): void {
    Reflect.set(plugin as unknown as object, 'currentActiveCell', cell);
}

function createToolbarButtons(plugin: TableToolbarPlugin): void {
    const createButtons = Reflect.get(plugin as unknown as object, 'createButtons');
    if (typeof createButtons !== 'function') {
        throw new Error('Missing createButtons on toolbar plugin');
    }

    createButtons.call(plugin);
}

describe('tableToolbarPlugin', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        jest.clearAllMocks();
    });

    it('refocuses the nested editor when a toolbar action is a no-op', () => {
        const view = createView();
        const plugin = new TableToolbarPlugin(view);
        const cell = createCell();

        setCurrentActiveCell(plugin, cell);
        createToolbarButtons(plugin);
        mockMoveRowUp.mockReturnValue(false);
        mockIsNestedEditorOpen.mockReturnValue(true);

        getToolbarButton(plugin, 'Move row up').click();

        expect(mockMoveRowUp).toHaveBeenCalledWith(view, cell);
        expect(mockRefocusNestedEditor).toHaveBeenCalledWith(view);

        plugin.destroy();
    });

    it('does not refocus the nested editor after a handled toolbar action', () => {
        const view = createView();
        const plugin = new TableToolbarPlugin(view);
        const cell = createCell();

        setCurrentActiveCell(plugin, cell);
        createToolbarButtons(plugin);
        mockMoveRowUp.mockReturnValue(true);
        mockIsNestedEditorOpen.mockReturnValue(true);

        getToolbarButton(plugin, 'Move row up').click();

        expect(mockMoveRowUp).toHaveBeenCalledWith(view, cell);
        expect(mockRefocusNestedEditor).not.toHaveBeenCalled();

        plugin.destroy();
    });
});

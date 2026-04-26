/**
 * @jest-environment jsdom
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { EditorView } from '@codemirror/view';
import type { ActiveCell } from '../tableState/activeCellState';
import type { ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';

const mockGetResolvedActiveCell = jest.fn();
const mockRunStructuralAction = jest.fn();
const mockIsNestedEditorOpen = jest.fn();
const mockRefocusNestedEditor = jest.fn();

jest.mock('../tableRuntime/activeCell/resolvedActiveCell', () => ({
    getResolvedActiveCell: mockGetResolvedActiveCell,
}));

jest.mock('../tableRuntime/operations/structuralActions', () => ({
    runStructuralAction: mockRunStructuralAction,
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
    return { dom, state: { doc: { length: 0 } } } as unknown as EditorView;
}

function createResolvedCell(activeCell: ActiveCell): ResolvedActiveCell {
    return {
        activeCell,
        tableFrom: activeCell.tableFrom,
        tableTo: 100,
        contentFrom: 0,
        contentTo: 0,
        editableFrom: 0,
        editableTo: 0,
        ctx: {
            from: activeCell.tableFrom,
            to: 100,
            text: '',
            table: {},
            cellRanges: { headers: [], rows: [] },
        },
    } as unknown as ResolvedActiveCell;
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
        const resolvedCell = createResolvedCell(cell);

        setCurrentActiveCell(plugin, cell);
        createToolbarButtons(plugin);
        mockGetResolvedActiveCell.mockReturnValue(resolvedCell);
        mockRunStructuralAction.mockReturnValue(false);
        mockIsNestedEditorOpen.mockReturnValue(true);

        getToolbarButton(plugin, 'Move row up').click();

        expect(mockGetResolvedActiveCell).toHaveBeenCalledWith(view.state);
        expect(mockRunStructuralAction).toHaveBeenCalledWith(view, 'moveRowUp', resolvedCell);
        expect(mockRefocusNestedEditor).toHaveBeenCalledWith(view);

        plugin.destroy();
    });

    it('does not refocus the nested editor after a handled toolbar action', () => {
        const view = createView();
        const plugin = new TableToolbarPlugin(view);
        const cell = createCell();
        const resolvedCell = createResolvedCell(cell);

        setCurrentActiveCell(plugin, cell);
        createToolbarButtons(plugin);
        mockGetResolvedActiveCell.mockReturnValue(resolvedCell);
        mockRunStructuralAction.mockReturnValue(true);
        mockIsNestedEditorOpen.mockReturnValue(true);

        getToolbarButton(plugin, 'Move row up').click();

        expect(mockRunStructuralAction).toHaveBeenCalledWith(view, 'moveRowUp', resolvedCell);
        expect(mockRefocusNestedEditor).not.toHaveBeenCalled();

        plugin.destroy();
    });

    it('does not run a toolbar action when the active cell no longer resolves', () => {
        const view = createView();
        const plugin = new TableToolbarPlugin(view);

        setCurrentActiveCell(plugin, createCell());
        createToolbarButtons(plugin);
        mockGetResolvedActiveCell.mockReturnValue(null);
        mockIsNestedEditorOpen.mockReturnValue(true);

        getToolbarButton(plugin, 'Move row up').click();

        expect(mockGetResolvedActiveCell).toHaveBeenCalledWith(view.state);
        expect(mockRunStructuralAction).not.toHaveBeenCalled();
        expect(mockRefocusNestedEditor).toHaveBeenCalledWith(view);

        plugin.destroy();
    });
});

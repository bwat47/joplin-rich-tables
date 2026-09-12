import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { activeCellField, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import type { ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { defaultHostEditorConfig } from '../../contentScriptBridge/hostEditorConfigBridge';
import { hostEditorConfigFacet } from '../services/hostEditorConfig';

const { mockGetResolvedActiveCell, mockRunStructuralAction, mockIsNestedEditorOpen, mockRefocusNestedEditor } =
    vi.hoisted(() => ({
        mockGetResolvedActiveCell: vi.fn(),
        mockRunStructuralAction: vi.fn(),
        mockIsNestedEditorOpen: vi.fn(),
        mockRefocusNestedEditor: vi.fn(),
    }));

vi.mock('../tableRuntime/activeCell/resolvedActiveCell', () => ({
    getResolvedActiveCell: mockGetResolvedActiveCell,
}));

vi.mock('../tableRuntime/operations/structuralActions', () => ({
    runStructuralAction: mockRunStructuralAction,
}));

vi.mock('../nestedEditor/nestedEditorController', () => ({
    isNestedEditorOpen: mockIsNestedEditorOpen,
    refocusNestedEditor: mockRefocusNestedEditor,
}));

import { tableToolbarPlugin, type TableToolbarPlugin } from '../toolbar/tableToolbarPlugin';

function createCell(): ActiveCell {
    return {
        tableFrom: 12,
        section: 'body',
        row: 0,
        col: 1,
    };
}

function createView(): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    return new EditorView({
        parent,
        state: EditorState.create({
            extensions: [activeCellField, hostEditorConfigFacet.of(defaultHostEditorConfig()), tableToolbarPlugin],
        }),
    });
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

function requireToolbarPlugin(view: EditorView): TableToolbarPlugin {
    const plugin = view.plugin(tableToolbarPlugin);
    if (!plugin) {
        throw new Error('Expected table toolbar plugin');
    }

    return plugin;
}

function activateCell(view: EditorView, cell: ActiveCell): void {
    view.dispatch({ effects: setActiveCellEffect.of(cell) });
}

describe('tableToolbarPlugin', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('refocuses the nested editor when a toolbar action is a no-op', () => {
        const view = createView();
        const plugin = requireToolbarPlugin(view);
        const cell = createCell();
        const resolvedCell = createResolvedCell(cell);

        activateCell(view, cell);
        mockGetResolvedActiveCell.mockReturnValue(resolvedCell);
        mockRunStructuralAction.mockReturnValue(false);
        mockIsNestedEditorOpen.mockReturnValue(true);

        getToolbarButton(plugin, 'Move row up').click();

        expect(mockGetResolvedActiveCell).toHaveBeenCalledWith(view.state);
        expect(mockRunStructuralAction).toHaveBeenCalledWith(view, 'moveRowUp', resolvedCell);
        expect(mockRefocusNestedEditor).toHaveBeenCalledWith(view);

        view.destroy();
    });

    it('does not refocus the nested editor after a handled toolbar action', () => {
        const view = createView();
        const plugin = requireToolbarPlugin(view);
        const cell = createCell();
        const resolvedCell = createResolvedCell(cell);

        activateCell(view, cell);
        mockGetResolvedActiveCell.mockReturnValue(resolvedCell);
        mockRunStructuralAction.mockReturnValue(true);
        mockIsNestedEditorOpen.mockReturnValue(true);

        getToolbarButton(plugin, 'Move row up').click();

        expect(mockRunStructuralAction).toHaveBeenCalledWith(view, 'moveRowUp', resolvedCell);
        expect(mockRefocusNestedEditor).not.toHaveBeenCalled();

        view.destroy();
    });

    it('does not run a toolbar action when the active cell no longer resolves', () => {
        const view = createView();
        const plugin = requireToolbarPlugin(view);

        activateCell(view, createCell());
        mockGetResolvedActiveCell.mockReturnValue(null);
        mockIsNestedEditorOpen.mockReturnValue(true);

        getToolbarButton(plugin, 'Move row up').click();

        expect(mockGetResolvedActiveCell).toHaveBeenCalledWith(view.state);
        expect(mockRunStructuralAction).not.toHaveBeenCalled();
        expect(mockRefocusNestedEditor).toHaveBeenCalledWith(view);

        view.destroy();
    });

    it('routes the ascending sort button through the active column action', () => {
        const view = createView();
        const plugin = requireToolbarPlugin(view);
        const cell = createCell();
        const resolvedCell = createResolvedCell(cell);

        activateCell(view, cell);
        mockGetResolvedActiveCell.mockReturnValue(resolvedCell);
        mockRunStructuralAction.mockReturnValue(true);

        getToolbarButton(plugin, 'Sort rows by column (A to Z)').click();

        expect(mockRunStructuralAction).toHaveBeenCalledWith(view, 'sortColumnAscending', resolvedCell);

        view.destroy();
    });
});

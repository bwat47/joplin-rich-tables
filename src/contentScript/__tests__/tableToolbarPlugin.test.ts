import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
    activeCellField,
    clearActiveCellEffect,
    setActiveCellEffect,
    type ActiveCell,
} from '../tableState/activeCellState';
import type { ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { defaultHostEditorConfig } from '../../contentScriptBridge/hostEditorConfigBridge';
import { hostEditorConfigFacet } from '../services/hostEditorConfig';
import { CLASS_FLOATING_TOOLBAR } from '../tableWidget/domHelpers';

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

import { tableToolbarPlugin } from '../toolbar/tableToolbarPlugin';

const createdViews: EditorView[] = [];

function createCell(): ActiveCell {
    return {
        tableFrom: 12,
        section: 'body',
        row: 0,
        col: 1,
    };
}

function createView(): EditorView {
    const view = new EditorView({
        parent: document.body,
        state: EditorState.create({
            extensions: [activeCellField, hostEditorConfigFacet.of(defaultHostEditorConfig()), tableToolbarPlugin],
        }),
    });
    createdViews.push(view);
    return view;
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

function getToolbarButton(view: EditorView, ariaLabel: string): HTMLButtonElement {
    const button = view.dom.querySelector(`button[aria-label="${ariaLabel}"]`);
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing toolbar button: ${ariaLabel}`);
    }

    return button;
}

function getToolbar(view: EditorView): HTMLElement {
    const toolbar = view.dom.querySelector(`.${CLASS_FLOATING_TOOLBAR}`);
    if (!(toolbar instanceof HTMLElement)) {
        throw new Error('Missing toolbar element');
    }

    return toolbar;
}

function activateCell(view: EditorView, cell: ActiveCell): void {
    view.dispatch({ effects: setActiveCellEffect.of(cell) });
}

function clearActiveCell(view: EditorView): void {
    view.dispatch({ effects: clearActiveCellEffect.of(undefined) });
}

describe('tableToolbarPlugin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        for (const view of createdViews.splice(0)) {
            view.destroy();
        }
        document.body.replaceChildren();
    });

    it('creates toolbar buttons when a cell becomes active, before any positioning runs', () => {
        const view = createView();
        const toolbar = getToolbar(view);

        expect(toolbar.querySelector('button')).toBeNull();

        activateCell(view, createCell());

        // No measure cycle has run, so this asserts button creation is independent of positioning.
        expect(getToolbarButton(view, 'Move row up')).toBeInstanceOf(HTMLButtonElement);
    });

    it('refocuses the nested editor when a toolbar action is a no-op', () => {
        const view = createView();
        const cell = createCell();
        const resolvedCell = createResolvedCell(cell);

        activateCell(view, cell);
        mockGetResolvedActiveCell.mockReturnValue(resolvedCell);
        mockRunStructuralAction.mockReturnValue(false);
        mockIsNestedEditorOpen.mockReturnValue(true);

        getToolbarButton(view, 'Move row up').click();

        expect(mockGetResolvedActiveCell).toHaveBeenCalledWith(view.state);
        expect(mockRunStructuralAction).toHaveBeenCalledWith(view, 'moveRowUp', resolvedCell);
        expect(mockRefocusNestedEditor).toHaveBeenCalledWith(view);
    });

    it('does not refocus the nested editor after a handled toolbar action', () => {
        const view = createView();
        const cell = createCell();
        const resolvedCell = createResolvedCell(cell);

        activateCell(view, cell);
        mockGetResolvedActiveCell.mockReturnValue(resolvedCell);
        mockRunStructuralAction.mockReturnValue(true);
        mockIsNestedEditorOpen.mockReturnValue(true);

        getToolbarButton(view, 'Move row up').click();

        expect(mockRunStructuralAction).toHaveBeenCalledWith(view, 'moveRowUp', resolvedCell);
        expect(mockRefocusNestedEditor).not.toHaveBeenCalled();
    });

    it('does not run a toolbar action when the active cell no longer resolves', () => {
        const view = createView();

        activateCell(view, createCell());
        mockGetResolvedActiveCell.mockReturnValue(null);
        mockIsNestedEditorOpen.mockReturnValue(true);

        getToolbarButton(view, 'Move row up').click();

        expect(mockGetResolvedActiveCell).toHaveBeenCalledWith(view.state);
        expect(mockRunStructuralAction).not.toHaveBeenCalled();
        expect(mockRefocusNestedEditor).toHaveBeenCalledWith(view);
    });

    it('routes the ascending sort button through the active column action', () => {
        const view = createView();
        const cell = createCell();
        const resolvedCell = createResolvedCell(cell);

        activateCell(view, cell);
        mockGetResolvedActiveCell.mockReturnValue(resolvedCell);
        mockRunStructuralAction.mockReturnValue(true);

        getToolbarButton(view, 'Sort rows by column (A to Z)').click();

        expect(mockRunStructuralAction).toHaveBeenCalledWith(view, 'sortColumnAscending', resolvedCell);
    });

    it('hides the toolbar when the active cell is cleared', () => {
        const view = createView();
        const toolbar = getToolbar(view);

        activateCell(view, createCell());
        // Positioning never completes here: there is no table widget to anchor to, so the
        // toolbar is left in the hidden pre-positioning state. Stage the visible state that a
        // successful placement would have produced, so the assertions below cannot pass by default.
        toolbar.style.display = 'flex';
        toolbar.style.visibility = 'visible';

        clearActiveCell(view);

        expect(toolbar.style.display).toBe('none');
        expect(toolbar.style.visibility).toBe('hidden');
    });
});

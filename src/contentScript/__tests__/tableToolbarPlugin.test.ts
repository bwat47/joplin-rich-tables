import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
    activeCellField,
    clearActiveCellEffect,
    setActiveCellEffect,
    type ActiveCell,
} from '../tableState/activeCellState';
import { defaultHostEditorConfig } from '../../contentScriptBridge/hostEditorConfigBridge';
import { hostEditorConfigFacet } from '../services/hostEditorConfig';
import { CLASS_FLOATING_TOOLBAR } from '../tableWidget/domHelpers';
import { triggerOpenCellRequestEffect } from '../tableState/openCellRequestState';

const { mockRunStructuralActionOnActiveCell } = vi.hoisted(() => ({
    mockRunStructuralActionOnActiveCell: vi.fn(),
}));

vi.mock('../tableRuntime/operations/structuralActions', () => ({
    runStructuralActionOnActiveCell: mockRunStructuralActionOnActiveCell,
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
    view.dispatch({ effects: clearActiveCellEffect.of(null) });
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

    it.each([
        ['Move row up', 'moveRowUp'],
        ['Sort rows by column (A to Z)', 'sortColumnAscending'],
    ])('routes the %s button to its action on the active cell', (label, actionId) => {
        const view = createView();

        activateCell(view, createCell());
        getToolbarButton(view, label).click();

        expect(mockRunStructuralActionOnActiveCell).toHaveBeenCalledWith(view, actionId);
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

    it('repositions after activation moves to another cell in the same table', () => {
        const view = createView();
        activateCell(view, createCell());
        const requestMeasure = vi.spyOn(view, 'requestMeasure');
        requestMeasure.mockClear();

        activateCell(view, { ...createCell(), col: 0 });

        expect(requestMeasure).toHaveBeenCalledWith(
            expect.objectContaining({ key: expect.anything(), read: expect.any(Function), write: expect.any(Function) })
        );
    });

    it('repositions for an open request even when active-cell identity is unchanged', () => {
        const view = createView();
        activateCell(view, createCell());
        const requestMeasure = vi.spyOn(view, 'requestMeasure');
        requestMeasure.mockClear();

        view.dispatch({ effects: triggerOpenCellRequestEffect.of({ requestId: 'same-cell' }) });

        expect(requestMeasure).toHaveBeenCalledWith(
            expect.objectContaining({ key: expect.anything(), read: expect.any(Function), write: expect.any(Function) })
        );
    });
});

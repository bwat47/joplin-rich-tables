import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { activateCellAtPosition } from '../tableWidget/cellActivation';
import { getCellSelector, SECTION_BODY, SECTION_HEADER } from '../tableWidget/domHelpers';
import { activeCellField, getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableWidget/activeCellState';
import { cellSelectionField, getCellSelection, setCellSelectionEffect } from '../tableWidget/cellSelectionState';
import { openNestedCellEditor } from '../nestedEditor/nestedCellEditor';
import { sourceModeField } from '../tableWidget/sourceMode';
import { createMarkdownState } from './testMarkdownState';
import { handleTableInteraction } from '../tableWidget/tableWidgetInteractions';
import { navigateCell } from '../tableWidget/tableNavigation';
import { consumePendingCellOpenOptions, clearPendingCellOpen } from '../nestedEditor/pendingCellOpen';
import { resetNavigationLock } from '../tableWidget/navigationLock';

const openActiveCellSessionMock = jest.fn();

jest.mock('../nestedEditor/activeCellSession', () => ({
    activeCellSessionPlugin: {},
    cleanupHostedActiveCellSessions: jest.fn(),
    closeActiveCellSession: jest.fn(),
    handleMainEditorSessionUpdate: jest.fn(),
    isActiveCellSessionOpen: jest.fn(() => false),
    openActiveCellSession: (...args: unknown[]) => openActiveCellSessionMock(...args),
    refocusActiveCellSession: jest.fn(),
}));

const NON_CANONICAL_DOC = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');
const CANONICAL_DOC = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');

interface CellStub {
    dataset: Record<string, string>;
    closest: (selector: string) => unknown;
}

interface MutableTestView {
    state: EditorState;
    dispatch: jest.Mock;
    focus: jest.Mock;
    posAtDOM: jest.Mock;
    contentDOM: {
        querySelectorAll: jest.Mock;
    };
    dom: {
        isConnected: boolean;
    };
}

function createViewHarness(params?: { doc?: string; activeCell?: ActiveCell }): {
    view: EditorView;
    cells: {
        header0: HTMLElement;
        header1: HTMLElement;
        body0: HTMLElement;
        body1: HTMLElement;
    };
} {
    let currentState = createMarkdownState(params?.doc ?? NON_CANONICAL_DOC, [
        activeCellField,
        cellSelectionField,
        sourceModeField,
    ]);
    if (params?.activeCell) {
        currentState = currentState.update({ effects: setActiveCellEffect.of(params.activeCell) }).state;
    }

    const widget = {
        querySelector: jest.fn((selector: string) => cellMap.get(selector) ?? null),
    };

    const createCellStub = (section: 'header' | 'body', row: number, col: number): HTMLElement => {
        const cell = {
            dataset: {
                section,
                row: String(row),
                col: String(col),
            },
            closest: (selector: string) => {
                if (selector === 'td, th') {
                    return cell;
                }
                if (selector === 'a') {
                    return null;
                }
                if (selector.includes('cm-table-widget')) {
                    return widget;
                }
                return null;
            },
        } satisfies CellStub;

        return cell as unknown as HTMLElement;
    };

    const cells = {
        header0: createCellStub(SECTION_HEADER, 0, 0),
        header1: createCellStub(SECTION_HEADER, 0, 1),
        body0: createCellStub(SECTION_BODY, 0, 0),
        body1: createCellStub(SECTION_BODY, 0, 1),
    };

    const cellMap = new Map<string, HTMLElement>([
        [getCellSelector({ section: 'header', row: 0, col: 0 }), cells.header0],
        [getCellSelector({ section: 'header', row: 0, col: 1 }), cells.header1],
        [getCellSelector({ section: 'body', row: 0, col: 0 }), cells.body0],
        [getCellSelector({ section: 'body', row: 0, col: 1 }), cells.body1],
    ]);

    const view: MutableTestView = {
        state: currentState,
        dispatch: jest.fn((spec: Parameters<EditorView['dispatch']>[0]) => {
            currentState = currentState.update(spec).state;
            view.state = currentState;
        }),
        focus: jest.fn(),
        posAtDOM: jest.fn(() => 0),
        contentDOM: {
            querySelectorAll: jest.fn(() => [widget]),
        },
        dom: {
            isConnected: true,
        },
    };

    return { view: view as unknown as EditorView, cells };
}

describe('interactive cell normalization', () => {
    beforeEach(() => {
        openActiveCellSessionMock.mockReset();
        resetNavigationLock();
    });

    afterEach(() => {
        resetNavigationLock();
        openActiveCellSessionMock.mockReset();
    });

    it('normalizes on mousedown cell activation before opening the nested editor', () => {
        const { view, cells } = createViewHarness();
        const event = {
            type: 'mousedown',
            button: 0,
            target: cells.header0,
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        } as unknown as MouseEvent;

        expect(handleTableInteraction(view, event)).toBe(true);
        expect(view.state.doc.toString()).toBe(CANONICAL_DOC);
        expect(getActiveCell(view.state)).toMatchObject({
            section: 'header',
            row: 0,
            col: 0,
        });
        expect(openActiveCellSessionMock).not.toHaveBeenCalled();
    });

    it('starts rectangular selection on shift-click from the active cell', () => {
        const { view, cells } = createViewHarness({
            activeCell: {
                anchorPos: NON_CANONICAL_DOC.indexOf('H1'),
                tableFrom: 0,
                section: 'header',
                row: 0,
                col: 0,
            },
        });
        const event = {
            type: 'mousedown',
            button: 0,
            shiftKey: true,
            target: cells.body1,
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        } as unknown as MouseEvent;

        expect(handleTableInteraction(view, event)).toBe(true);
        expect(getActiveCell(view.state)).toBeNull();
        expect(getCellSelection(view.state)).toEqual({
            tableFrom: 0,
            anchor: { section: 'header', row: 0, col: 0 },
            focus: { section: 'body', row: 0, col: 1 },
        });
        expect(openActiveCellSessionMock).not.toHaveBeenCalled();
    });

    it('clears an existing selection before activating a clicked cell', () => {
        const { view, cells } = createViewHarness();
        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'header', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });

        const event = {
            type: 'mousedown',
            button: 0,
            target: cells.body0,
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        } as unknown as MouseEvent;

        expect(handleTableInteraction(view, event)).toBe(true);
        expect(getCellSelection(view.state)).toBeNull();
        expect(getActiveCell(view.state)).toMatchObject({
            section: 'body',
            row: 0,
            col: 0,
        });
    });

    it('normalizes on cursor activation before opening the nested editor', () => {
        const { view } = createViewHarness();

        expect(activateCellAtPosition(view, NON_CANONICAL_DOC.indexOf('H1'))).toBe(true);
        expect(view.state.doc.toString()).toBe(CANONICAL_DOC);
        expect(getActiveCell(view.state)).toMatchObject({
            section: 'header',
            row: 0,
            col: 0,
        });
        expect(openActiveCellSessionMock).not.toHaveBeenCalled();
    });

    it('can skip normalization on cursor activation for lifecycle-driven re-entry', () => {
        const { view } = createViewHarness();

        expect(activateCellAtPosition(view, NON_CANONICAL_DOC.indexOf('H1'), { normalizeIfNeeded: false })).toBe(true);
        expect(view.state.doc.toString()).toBe(NON_CANONICAL_DOC);
        expect(openActiveCellSessionMock).toHaveBeenCalledTimes(1);
    });

    it('normalizes on keyboard navigation before reopening the target cell', () => {
        const { view } = createViewHarness({
            activeCell: {
                anchorPos: NON_CANONICAL_DOC.indexOf('H1'),
                tableFrom: 0,
                section: 'header',
                row: 0,
                col: 0,
            },
        });

        expect(navigateCell(view, 'next', { cursorPos: 'end' })).toBe(true);
        expect(view.state.doc.toString()).toBe(CANONICAL_DOC);

        const activeCell = getActiveCell(view.state);
        expect(activeCell).toMatchObject({
            section: 'header',
            row: 0,
            col: 1,
        });
        expect(openActiveCellSessionMock).not.toHaveBeenCalled();
        expect(consumePendingCellOpenOptions(view, activeCell!)).toEqual({
            initialCursorPos: 'end',
        });

        clearPendingCellOpen(view);
    });

    it('normalizes directly through the shared nested-editor gate', () => {
        const { view, cells } = createViewHarness({
            activeCell: {
                anchorPos: NON_CANONICAL_DOC.indexOf('a'),
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 0,
            },
        });

        openNestedCellEditor({
            mainView: view,
            cellElement: cells.body0,
            activeCell: getActiveCell(view.state)!,
            normalizeIfNeeded: true,
        });

        expect(view.state.doc.toString()).toBe(CANONICAL_DOC);
        expect(getActiveCell(view.state)).toMatchObject({
            section: 'body',
            row: 0,
            col: 0,
        });
        expect(openActiveCellSessionMock).not.toHaveBeenCalled();
    });

    it('skips normalization when the shared open path is used for lifecycle-style reopen', () => {
        const { view, cells } = createViewHarness({
            activeCell: {
                anchorPos: NON_CANONICAL_DOC.indexOf('a'),
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 0,
            },
        });

        openNestedCellEditor({
            mainView: view,
            cellElement: cells.body0,
            activeCell: getActiveCell(view.state)!,
            normalizeIfNeeded: false,
        });

        expect(view.state.doc.toString()).toBe(NON_CANONICAL_DOC);
        expect(openActiveCellSessionMock).toHaveBeenCalledTimes(1);
    });
});

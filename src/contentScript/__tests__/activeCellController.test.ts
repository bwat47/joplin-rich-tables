import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { activeCellField, getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { cellSelectionField, getCellSelection, setCellSelectionEffect } from '../tableState/cellSelectionState';
import { sourceModeField } from '../tableState/sourceMode';
import { createMarkdownState } from './testMarkdownState';
import { getCellSelector, SECTION_BODY, SECTION_HEADER } from '../tableWidget/domHelpers';
import { activateCell, clearActiveCell, retargetAfterTableRewrite } from '../tableRuntime/activeCellController';
import { consumePendingCellOpenOptions } from '../nestedEditor/pendingCellOpen';
import { createActiveCellForTableText } from '../tableRuntime/activeCellFactory';

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

describe('activeCellController', () => {
    beforeEach(() => {
        openActiveCellSessionMock.mockReset();
    });

    it('clears cell selection explicitly when activating a cell', () => {
        const { view, cells } = createViewHarness({ doc: CANONICAL_DOC });
        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'header', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });

        expect(
            activateCell(view, {
                activeCell: {
                    anchorPos: CANONICAL_DOC.indexOf('a'),
                    tableFrom: 0,
                    section: 'body',
                    row: 0,
                    col: 0,
                },
                cellElement: cells.body0,
                selectionPolicy: 'clear',
                selection: { anchor: CANONICAL_DOC.indexOf('a') },
            })
        ).toBe(true);

        expect(getCellSelection(view.state)).toBeNull();
        expect(getActiveCell(view.state)).toMatchObject({
            section: 'body',
            row: 0,
            col: 0,
        });
        expect(openActiveCellSessionMock).toHaveBeenCalledTimes(1);
    });

    it('retargets after a table rewrite and preserves pending cursor placement', () => {
        const { view } = createViewHarness();
        const nextActiveCell = createActiveCellForTableText({
            tableFrom: 0,
            tableText: CANONICAL_DOC,
            target: { section: 'body', row: 0, col: 1 },
        });

        expect(nextActiveCell).not.toBeNull();

        retargetAfterTableRewrite(view, {
            nextActiveCell: nextActiveCell!,
            changes: {
                from: 0,
                to: NON_CANONICAL_DOC.length,
                insert: CANONICAL_DOC,
            },
            selection: { anchor: nextActiveCell!.anchorPos },
            rebuildTableFrom: 0,
            initialCursorPos: 'end',
        });

        expect(view.state.doc.toString()).toBe(CANONICAL_DOC);
        expect(getActiveCell(view.state)).toEqual(nextActiveCell);
        expect(consumePendingCellOpenOptions(view, nextActiveCell!)).toEqual({
            initialCursorPos: 'end',
        });
        expect(openActiveCellSessionMock).not.toHaveBeenCalled();
    });

    it('clears active cell state and pending open metadata together', () => {
        const activeCell = {
            anchorPos: CANONICAL_DOC.indexOf('a'),
            tableFrom: 0,
            section: 'body' as const,
            row: 0,
            col: 0,
        };
        const { view } = createViewHarness({ doc: CANONICAL_DOC, activeCell });
        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'header', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });

        retargetAfterTableRewrite(view, {
            nextActiveCell: activeCell,
            rebuildTableFrom: 0,
            initialCursorPos: 'start',
        });

        clearActiveCell(view, {
            reason: 'test-clear',
            clearSelection: true,
        });

        expect(getActiveCell(view.state)).toBeNull();
        expect(getCellSelection(view.state)).toBeNull();
        expect(consumePendingCellOpenOptions(view, activeCell)).toBeUndefined();
    });
});

import { vi, type Mock } from 'vitest';
import { EditorState, type Extension, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { getCellSelector, SECTION_BODY, SECTION_HEADER } from '../tableWidget/domHelpers';
import { activeCellField, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { cellSelectionField } from '../tableState/cellSelectionState';
import { sourceModeField } from '../tableState/sourceMode';
import { openCellRequestField } from '../tableRuntime/openCellRequest';
import { createMarkdownState } from './testMarkdownState';

export const NON_CANONICAL_DOC = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');

interface CellStub {
    dataset: Record<string, string>;
    closest: (selector: string) => unknown;
}

export interface MutableTestView {
    state: EditorState;
    dispatch: Mock<(spec: TransactionSpec) => void>;
    focus: Mock;
    posAtDOM: Mock;
    requestMeasure: Mock;
    contentDOM: {
        querySelectorAll: Mock;
    };
    dom: {
        isConnected: boolean;
    };
}

export function getLastDispatchSpec(view: MutableTestView): TransactionSpec {
    const call = view.dispatch.mock.calls.at(-1);
    if (!call) {
        throw new Error('Expected a dispatch call');
    }
    return call[0];
}

export function createInteractiveTableHarness(params?: {
    doc?: string;
    activeCell?: ActiveCell;
    extensions?: Extension[];
}): {
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
        openCellRequestField,
        ...(params?.extensions ?? []),
    ]);
    if (params?.activeCell) {
        currentState = currentState.update({ effects: setActiveCellEffect.of(params.activeCell) }).state;
    }

    const widget = {
        querySelector: vi.fn((selector: string) => cellMap.get(selector) ?? null),
    };

    const createCellStub = (section: 'header' | 'body', row: number, col: number): HTMLElement => {
        const cell: CellStub = {
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
        };

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
        dispatch: vi.fn((spec: TransactionSpec) => {
            currentState = currentState.update(spec).state;
            view.state = currentState;
        }),
        focus: vi.fn(),
        posAtDOM: vi.fn(() => 0),
        requestMeasure: vi.fn(),
        contentDOM: {
            querySelectorAll: vi.fn(() => [widget]),
        },
        dom: {
            isConnected: true,
        },
    };

    return { view: view as unknown as EditorView, cells };
}

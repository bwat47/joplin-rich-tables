import type { EditorState, Extension, TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { vi, type Mock } from 'vitest';

import { activeCellField, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { cellSelectionField } from '../tableState/cellSelectionState';
import { openCellRequestField } from '../tableState/openCellRequestState';
import { sourceModeField } from '../tableState/sourceMode';
import { createMarkdownState } from './testMarkdownState';

export const NON_CANONICAL_DOC = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');

export interface MutableTestView {
    state: EditorState;
    dispatch: Mock<(spec: TransactionSpec) => void>;
    focus: Mock;
    posAtDOM: Mock;
    requestMeasure: Mock;
    plugin: Mock;
    contentDOM: {
        querySelectorAll: Mock;
    };
    dom: {
        isConnected: boolean;
    };
}

export function getLastDispatchSpec(view: MutableTestView): TransactionSpec {
    const call = view.dispatch.mock.calls[view.dispatch.mock.calls.length - 1];
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

    const view: MutableTestView = {
        state: currentState,
        dispatch: vi.fn((spec: TransactionSpec) => {
            currentState = currentState.update(spec).state;
            view.state = currentState;
        }),
        focus: vi.fn(),
        posAtDOM: vi.fn(() => 0),
        requestMeasure: vi.fn(),
        plugin: vi.fn(() => null),
        contentDOM: {
            querySelectorAll: vi.fn(() => []),
        },
        dom: {
            isConnected: true,
        },
    };

    return { view: view as unknown as EditorView };
}

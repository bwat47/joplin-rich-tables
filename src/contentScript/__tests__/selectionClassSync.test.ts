/** @vitest-environment jsdom */

import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markdownRenderServiceFacet } from '../services/markdownRenderer';
import { cellDragField } from '../tableState/cellDragState';
import {
    cellSelectionField,
    clearCellSelectionEffect,
    setCellSelectionEffect,
    type CellSelection,
} from '../tableState/cellSelectionState';
import { cellSelectionVisuals } from '../tableWidget/cellSelectionVisuals';
import { CLASS_CELL_SELECTED, CLASS_TABLE_WIDGET_SELECTED, getWidgetSelector } from '../tableWidget/domHelpers';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { wholeTableSelectionVisuals } from '../tableWidget/wholeTableSelectionVisuals';
import { createMarkdownState } from './testMarkdownState';

class ResizeObserverMock {
    observe = vi.fn();
    disconnect = vi.fn();
}

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
const PREFIX = 'above\n\n';
const DOC = `${PREFIX}${TABLE}\n\nbelow`;
const TABLE_FROM = PREFIX.length;
const TABLE_TO = TABLE_FROM + TABLE.length;
const EDIT_FROM = DOC.indexOf('a1');
const EDIT_INSERT = 'changed';

const BODY_ROW_SELECTION: CellSelection = {
    tableFrom: TABLE_FROM,
    anchor: { section: 'body', row: 0, col: 0 },
    focus: { section: 'body', row: 0, col: 1 },
};

const mountedViews: EditorView[] = [];

function mountView(): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const view = new EditorView({
        parent,
        state: createMarkdownState(DOC, [
            markdownRenderServiceFacet.of({
                getCached: vi.fn(() => undefined),
                render: vi.fn(async () => ''),
                clear: vi.fn(),
            }),
            cellSelectionField,
            cellDragField,
            tableDecorationField,
            cellSelectionVisuals,
            wholeTableSelectionVisuals,
        ]),
    });
    mountedViews.push(view);
    return view;
}

/** Resolves after every measure already queued on the view has written its DOM changes. */
function flushMeasure(view: EditorView): Promise<void> {
    return new Promise((resolve) => {
        view.requestMeasure({
            read: () => undefined,
            write: () => resolve(),
        });
    });
}

function getWidget(view: EditorView): HTMLElement {
    const widget = view.contentDOM.querySelector<HTMLElement>(getWidgetSelector());
    if (!widget) {
        throw new Error('Expected a rendered table widget');
    }
    return widget;
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock as unknown as typeof ResizeObserver);
});

afterEach(() => {
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('selection class synchronization', () => {
    it('marks selected cells, removes the marks, and reapplies them to replacement widget DOM', async () => {
        const view = mountView();

        view.dispatch({ effects: setCellSelectionEffect.of(BODY_ROW_SELECTION) });
        await flushMeasure(view);

        const originalWidget = getWidget(view);
        expect(originalWidget.querySelectorAll(`.${CLASS_CELL_SELECTED}`)).toHaveLength(2);

        view.dispatch({ effects: clearCellSelectionEffect.of(undefined) });
        await flushMeasure(view);
        expect(originalWidget.querySelectorAll(`.${CLASS_CELL_SELECTED}`)).toHaveLength(0);

        view.dispatch({
            changes: { from: EDIT_FROM, to: EDIT_FROM + 2, insert: EDIT_INSERT },
            effects: setCellSelectionEffect.of(BODY_ROW_SELECTION),
        });
        await flushMeasure(view);

        const replacementWidget = getWidget(view);
        expect(replacementWidget).not.toBe(originalWidget);
        expect(replacementWidget.querySelectorAll(`.${CLASS_CELL_SELECTED}`)).toHaveLength(2);
    });

    it('marks a wholly selected table, removes the mark, and reapplies it after widget replacement', async () => {
        const view = mountView();

        view.dispatch({ selection: EditorSelection.single(TABLE_FROM, TABLE_TO) });
        await flushMeasure(view);

        const originalWidget = getWidget(view);
        expect(originalWidget.classList.contains(CLASS_TABLE_WIDGET_SELECTED)).toBe(true);

        view.dispatch({ selection: EditorSelection.single(0) });
        await flushMeasure(view);
        expect(originalWidget.classList.contains(CLASS_TABLE_WIDGET_SELECTED)).toBe(false);

        view.dispatch({ selection: EditorSelection.single(TABLE_FROM, TABLE_TO) });
        view.dispatch({ changes: { from: EDIT_FROM, to: EDIT_FROM + 2, insert: EDIT_INSERT } });
        await flushMeasure(view);

        const replacementWidget = getWidget(view);
        expect(replacementWidget).not.toBe(originalWidget);
        expect(replacementWidget.classList.contains(CLASS_TABLE_WIDGET_SELECTED)).toBe(true);
    });
});

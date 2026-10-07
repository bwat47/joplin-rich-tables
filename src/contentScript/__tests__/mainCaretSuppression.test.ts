import { markdown } from '@codemirror/lang-markdown';
import { closeSearchPanel, openSearchPanel, search } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { afterEach, describe, expect, it } from 'vitest';
import {
    cellSelectionField,
    clearCellSelectionEffect,
    getCellSelection,
    setCellSelectionEffect,
} from '../tableState/cellSelectionState';
import { cellDragField, startCellDragEffect } from '../tableState/cellDragState';
import { sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { toggleSourceMode } from '../tableRuntime/sourceModeController';
import { activeCellField } from '../tableState/activeCellState';
import {
    beginOpenCellRequestEffect,
    clearOpenCellRequestEffect,
    openCellRequestField,
} from '../tableState/openCellRequestState';
import { mainCaretSuppression } from '../tableWidget/mainCaretSuppression';

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
const DOC = `above\n${TABLE}\nbelow`;
const TABLE_FROM = 'above'.length + 1;
const ATTR = 'data-rt-caret-suppressed';

const REQUEST_ID = 'open-cell-test';

const mountedViews: EditorView[] = [];

function mountView(): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const view = new EditorView({
        parent,
        doc: DOC,
        extensions: [
            markdown({ extensions: [GFM] }),
            search(),
            sourceModeField,
            cellSelectionField,
            cellDragField,
            activeCellField,
            openCellRequestField,
            mainCaretSuppression,
        ],
    });
    mountedViews.push(view);

    return view;
}

function beginOpenRequest(view: EditorView): void {
    view.dispatch({
        effects: beginOpenCellRequestEffect.of({
            requestId: REQUEST_ID,
            activeCell: { tableFrom: TABLE_FROM, section: 'body', row: 0, col: 0 },
            suppressKeys: false,
        }),
    });
}

function selectCells(view: EditorView): void {
    view.dispatch({
        effects: setCellSelectionEffect.of({
            tableFrom: TABLE_FROM,
            anchor: { section: 'header', row: 0, col: 0 },
            focus: { section: 'body', row: 0, col: 1 },
        }),
    });
}

afterEach(() => {
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
});

describe('mainCaretSuppression', () => {
    it.each(['source', 'search'] as const)('releases cell selection and the caret on entering %s mode', (mode) => {
        const view = mountView();
        view.dispatch({ selection: { anchor: TABLE_FROM + 2 } });
        selectCells(view);
        view.dispatch({ effects: startCellDragEffect.of(null) });
        const selection = view.state.selection;
        expect(view.dom.hasAttribute(ATTR)).toBe(true);

        if (mode === 'source') {
            toggleSourceMode(view);
        } else {
            openSearchPanel(view);
        }

        expect(getCellSelection(view.state)).toBeNull();
        expect(view.state.field(cellDragField)).toBe(false);
        expect(view.dom.hasAttribute(ATTR)).toBe(false);
        expect(view.state.selection.eq(selection)).toBe(true);

        // A stale cell-selection request cannot reclaim interaction in raw mode.
        selectCells(view);
        expect(getCellSelection(view.state)).toBeNull();
        expect(view.dom.hasAttribute(ATTR)).toBe(false);

        if (mode === 'source') {
            view.dispatch({ effects: toggleSourceModeEffect.of(false) });
        } else {
            closeSearchPanel(view);
        }

        expect(getCellSelection(view.state)).toBeNull();
        expect(view.dom.hasAttribute(ATTR)).toBe(false);
    });

    it('suppresses the caret while a cell selection is active', () => {
        const view = mountView();
        expect(view.dom.hasAttribute(ATTR)).toBe(false);

        selectCells(view);
        expect(view.dom.hasAttribute(ATTR)).toBe(true);

        view.dispatch({ effects: clearCellSelectionEffect.of(null) });
        expect(view.dom.hasAttribute(ATTR)).toBe(false);
    });

    it('suppresses the caret while a cell is opening', () => {
        // The request moves the main selection into the table's block widget a frame before the
        // nested editor mounts, so the caret would otherwise paint on the cell divider.
        const view = mountView();

        beginOpenRequest(view);
        expect(view.dom.hasAttribute(ATTR)).toBe(true);

        view.dispatch({ effects: clearOpenCellRequestEffect.of({ requestId: REQUEST_ID }) });
        expect(view.dom.hasAttribute(ATTR)).toBe(false);
    });

    it('keeps the caret suppressed until both reasons are gone', () => {
        // Clicking a cell inside an existing rectangle clears the selection and opens the cell in
        // one transaction, so the two reasons overlap and neither may lift the suppression alone.
        const view = mountView();
        selectCells(view);
        beginOpenRequest(view);

        view.dispatch({ effects: clearCellSelectionEffect.of(null) });
        expect(view.dom.hasAttribute(ATTR)).toBe(true);

        view.dispatch({ effects: clearOpenCellRequestEffect.of({ requestId: REQUEST_ID }) });
        expect(view.dom.hasAttribute(ATTR)).toBe(false);
    });
});

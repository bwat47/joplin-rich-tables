import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { afterEach, describe, expect, it } from 'vitest';
import { cellSelectionField, clearCellSelectionEffect, setCellSelectionEffect } from '../tableState/cellSelectionState';
import { activeCellField } from '../tableState/activeCellState';
import {
    beginOpenCellRequestEffect,
    clearOpenCellRequestEffect,
    openCellRequestField,
} from '../tableRuntime/openCellRequest';
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
            cellSelectionField,
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
    it('suppresses the caret while a cell selection is active', () => {
        const view = mountView();
        expect(view.dom.hasAttribute(ATTR)).toBe(false);

        selectCells(view);
        expect(view.dom.hasAttribute(ATTR)).toBe(true);

        view.dispatch({ effects: clearCellSelectionEffect.of(undefined) });
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

        view.dispatch({ effects: clearCellSelectionEffect.of(undefined) });
        expect(view.dom.hasAttribute(ATTR)).toBe(true);

        view.dispatch({ effects: clearOpenCellRequestEffect.of({ requestId: REQUEST_ID }) });
        expect(view.dom.hasAttribute(ATTR)).toBe(false);
    });
});

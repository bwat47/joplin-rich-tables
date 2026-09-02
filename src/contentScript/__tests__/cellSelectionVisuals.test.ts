/**
 * @vitest-environment jsdom
 */

import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { afterEach, describe, expect, it } from 'vitest';
import { cellSelectionField, clearCellSelectionEffect, setCellSelectionEffect } from '../tableState/cellSelectionState';
import { cellDragField, endCellDragEffect, startCellDragEffect } from '../tableState/cellDragState';
import { cellSelectionCaretSuppression, cellSelectionVisuals } from '../tableWidget/cellSelectionVisuals';

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
const DOC = `above\n${TABLE}\nbelow`;
const TABLE_FROM = 'above'.length + 1;

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
            cellDragField,
            cellSelectionCaretSuppression,
            cellSelectionVisuals,
        ],
    });
    mountedViews.push(view);

    return view;
}

afterEach(() => {
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
});

describe('cellSelectionCaretSuppression', () => {
    it('marks the editor while a cell selection is active and unmarks it afterwards', () => {
        const view = mountView();
        expect(view.dom.hasAttribute('data-rt-cell-selection')).toBe(false);

        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: TABLE_FROM,
                anchor: { section: 'header', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });
        expect(view.dom.hasAttribute('data-rt-cell-selection')).toBe(true);

        view.dispatch({ effects: clearCellSelectionEffect.of(undefined) });
        expect(view.dom.hasAttribute('data-rt-cell-selection')).toBe(false);
    });
});

describe('cell drag focus override', () => {
    it('marks the editor while a drag sweeps out a rectangle and unmarks it afterwards', () => {
        // The fill follows the editor's focus, but a drag leaves focus wherever it was until the
        // rectangle is final — so the gesture in progress has to assert focus for itself.
        const view = mountView();
        // A drag cannot outlive the selection it is sweeping out, so it only reads as in progress
        // alongside one.
        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: TABLE_FROM,
                anchor: { section: 'body', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });
        expect(view.dom.hasAttribute('data-rt-cell-drag')).toBe(false);

        view.dispatch({ effects: startCellDragEffect.of(undefined) });
        expect(view.dom.hasAttribute('data-rt-cell-drag')).toBe(true);

        view.dispatch({ effects: endCellDragEffect.of(undefined) });
        expect(view.dom.hasAttribute('data-rt-cell-drag')).toBe(false);
    });

    it('unmarks the editor when the drag selection disappears without an explicit end', () => {
        const view = mountView();
        const selection = {
            tableFrom: TABLE_FROM,
            anchor: { section: 'body' as const, row: 0, col: 0 },
            focus: { section: 'body' as const, row: 0, col: 1 },
        };
        view.dispatch({
            effects: [setCellSelectionEffect.of(selection), startCellDragEffect.of(undefined)],
        });
        expect(view.dom.hasAttribute('data-rt-cell-drag')).toBe(true);

        view.dispatch({ effects: clearCellSelectionEffect.of(undefined) });

        expect(view.state.field(cellDragField)).toBe(false);
        expect(view.dom.hasAttribute('data-rt-cell-drag')).toBe(false);

        view.dispatch({ effects: setCellSelectionEffect.of(selection) });

        expect(view.dom.hasAttribute('data-rt-cell-drag')).toBe(false);
    });
});

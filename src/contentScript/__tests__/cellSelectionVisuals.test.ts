import { markdown } from '@codemirror/lang-markdown';
import type { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { afterEach, describe, expect, it } from 'vitest';

import { cellDragField, endCellDragEffect, startCellDragEffect } from '../tableState/cellDragState';
import { cellSelectionField, clearCellSelectionEffect, setCellSelectionEffect } from '../tableState/cellSelectionState';
import { cellSelectionVisuals } from '../tableWidget/cellSelectionVisuals';
import { createEditorViewHarness } from './tableEditorFixtures';

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
const DOC = `above\n${TABLE}\nbelow`;
const TABLE_FROM = 'above'.length + 1;

const viewHarness = createEditorViewHarness();

function mountView(): EditorView {
    return viewHarness.mountView({
        doc: DOC,
        extensions: [markdown({ extensions: [GFM] }), cellSelectionField, cellDragField, cellSelectionVisuals],
    });
}

afterEach(() => {
    viewHarness.destroyViews();
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

        view.dispatch({ effects: startCellDragEffect.of(null) });
        expect(view.dom.hasAttribute('data-rt-cell-drag')).toBe(true);

        view.dispatch({ effects: endCellDragEffect.of(null) });
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
            effects: [setCellSelectionEffect.of(selection), startCellDragEffect.of(null)],
        });
        expect(view.dom.hasAttribute('data-rt-cell-drag')).toBe(true);

        view.dispatch({ effects: clearCellSelectionEffect.of(null) });

        expect(view.state.field(cellDragField)).toBe(false);
        expect(view.dom.hasAttribute('data-rt-cell-drag')).toBe(false);

        view.dispatch({ effects: setCellSelectionEffect.of(selection) });

        expect(view.dom.hasAttribute('data-rt-cell-drag')).toBe(false);
    });
});

/**
 * @vitest-environment jsdom
 */

import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { afterEach, describe, expect, it } from 'vitest';
import { cellSelectionField, clearCellSelectionEffect, setCellSelectionEffect } from '../tableState/cellSelectionState';
import { cellSelectionCaretSuppression } from '../tableWidget/cellSelectionVisuals';

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
        extensions: [markdown({ extensions: [GFM] }), cellSelectionField, cellSelectionCaretSuppression],
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

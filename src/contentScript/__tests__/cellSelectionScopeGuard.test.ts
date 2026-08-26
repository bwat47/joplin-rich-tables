/**
 * @vitest-environment jsdom
 */

import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { afterEach, describe, expect, it } from 'vitest';
import { activeCellField } from '../tableState/activeCellState';
import { cellSelectionField, getCellSelection, setCellSelectionEffect } from '../tableState/cellSelectionState';
import { selectWholeTable } from '../tableRuntime/selection/cellSelectionController';
import { cellSelectionScopeGuard } from '../tableRuntime/selection/cellSelectionScopeGuard';
import { resolveTableContextAtPos } from '../tableRuntime/tableResolution';

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
const PREFIX = 'above';
const DOC = `${PREFIX}\n${TABLE}\nbelow`;
const TABLE_FROM = PREFIX.length + 1;
const TABLE_TO = TABLE_FROM + TABLE.length;

const mountedViews: EditorView[] = [];

function mountView(): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const view = new EditorView({
        parent,
        doc: DOC,
        extensions: [markdown({ extensions: [GFM] }), activeCellField, cellSelectionField, cellSelectionScopeGuard],
    });
    mountedViews.push(view);

    return view;
}

/** The guard defers its clear to an animation frame; jsdom runs those on a timer. */
function flushFrames(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 32));
}

function selectTable(view: EditorView): void {
    const ctx = resolveTableContextAtPos(view.state, TABLE_FROM);
    expect(ctx).not.toBeNull();
    expect(selectWholeTable(view, ctx!, 'end')).toBe(true);
}

afterEach(() => {
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
});

describe('cellSelectionScopeGuard', () => {
    it('drops the selection when a main-editor command moves the caret out of the table', async () => {
        const view = mountView();
        selectTable(view);
        expect(getCellSelection(view.state)).not.toBeNull();

        // Stands in for any unhandled movement command, e.g. Ctrl+Home.
        view.dispatch({ selection: { anchor: 0 } });
        await flushFrames();

        expect(getCellSelection(view.state)).toBeNull();
    });

    it('keeps the selection while the caret stays inside the table', async () => {
        const view = mountView();
        selectTable(view);

        view.dispatch({ selection: { anchor: TABLE_TO - 1 } });
        await flushFrames();

        expect(getCellSelection(view.state)).not.toBeNull();
    });

    it('keeps the selection through the transitions that establish it', async () => {
        const view = mountView();
        selectTable(view);
        await flushFrames();

        expect(getCellSelection(view.state)).not.toBeNull();
    });

    it('drops the selection when only one end of a range leaves the table', async () => {
        const view = mountView();
        selectTable(view);

        view.dispatch({ selection: { anchor: TABLE_TO - 1, head: DOC.length } });
        await flushFrames();

        expect(getCellSelection(view.state)).toBeNull();
    });

    it('leaves a selection whose table no longer resolves to the existing cleanup paths', async () => {
        const view = mountView();
        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: DOC.length,
                anchor: { section: 'header', row: 0, col: 0 },
                focus: { section: 'header', row: 0, col: 0 },
            }),
        });

        view.dispatch({ selection: { anchor: 0 } });
        await flushFrames();

        expect(getCellSelection(view.state)).not.toBeNull();
    });
});

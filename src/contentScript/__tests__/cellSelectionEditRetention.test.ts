import { history, undo } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import type { CellCoords } from '../tableModel/types';
import { endCellDragSelection, setCellDragSelection } from '../tableRuntime/selection/cellSelectionController';
import { cellSelectionEditRetention } from '../tableRuntime/selection/cellSelectionEditRetention';
import { clearCellSelectionEffect, getCellSelection } from '../tableState/cellSelectionState';
import { cellSelectionTestExtensions } from './tableEditorFixtures';

const GRID_DOC = ['| H1 | H2 | H3 |', '| --- | --- | --- |', '| a1 | a2 | a3 |', '| b1 | b2 | b3 |'].join('\n');
const BOLD_MARKER = '**';

const mountedViews: EditorView[] = [];

function body(row: number, col: number): CellCoords {
    return { section: 'body', row, col };
}

function mountView(doc: string): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
        parent,
        doc,
        extensions: cellSelectionTestExtensions(
            history(),
            EditorState.allowMultipleSelections.of(true),
            cellSelectionEditRetention
        ),
    });
    mountedViews.push(view);
    return view;
}

/** Selects `anchor`–`focus` with a completed drag. */
function dragSelect(view: EditorView, anchor: CellCoords, focus: CellCoords): void {
    setCellDragSelection(view, 0, anchor, focus);
    endCellDragSelection(view, { keepActiveCell: false });
}

/** Mounts `doc` with body cells (0,0)–(1,1) selected. */
function mountWithSelection(doc = GRID_DOC): EditorView {
    const view = mountView(doc);
    dragSelect(view, body(0, 0), body(1, 1));
    return view;
}

/** Wraps every selection range in bold markers, the way the host's inline formatting commands do. */
function boldEveryRange(view: EditorView): void {
    view.dispatch(
        view.state.changeByRange((range) => ({
            changes: [
                { from: range.from, insert: BOLD_MARKER },
                { from: range.to, insert: BOLD_MARKER },
            ],
            range: EditorSelection.range(range.from + BOLD_MARKER.length, range.to + BOLD_MARKER.length),
        }))
    );
}

function insertAt(view: EditorView, text: string, insert: string): void {
    const from = view.state.doc.toString().indexOf(text);
    view.dispatch({ changes: { from, insert } });
}

afterEach(() => {
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
});

describe('cell selection edit retention', () => {
    it('keeps the selection when every selected cell is formatted', () => {
        const view = mountWithSelection();
        const before = getCellSelection(view.state);

        boldEveryRange(view);

        expect(getCellSelection(view.state)).toEqual(before);
    });

    it('keeps the selection when the formatting is undone', () => {
        const view = mountWithSelection();
        const before = getCellSelection(view.state);
        boldEveryRange(view);

        undo(view);

        expect(view.state.doc.toString()).toBe(GRID_DOC);
        expect(getCellSelection(view.state)).toEqual(before);
    });

    it.each([
        ['a cell outside the selection', 'a3', 'x'],
        ['a line break inside a selected cell', 'a1', '\n'],
        ['a pipe inside a selected cell', 'a1', '|'],
    ])('clears the selection for an edit that inserts into %s', (_label, cellText, insert) => {
        const view = mountWithSelection();

        insertAt(view, cellText, insert);

        expect(getCellSelection(view.state)).toBeNull();
    });

    it('clears the selection for an edit outside the table', () => {
        const view = mountWithSelection(`${GRID_DOC}\n\nafter`);

        insertAt(view, 'after', 'x');

        expect(getCellSelection(view.state)).toBeNull();
    });

    it('leaves an explicit clear in the same transaction in charge', () => {
        const view = mountWithSelection();

        view.dispatch({
            changes: { from: view.state.doc.toString().indexOf('a1'), insert: 'x' },
            effects: clearCellSelectionEffect.of(null),
        });

        expect(getCellSelection(view.state)).toBeNull();
    });
});

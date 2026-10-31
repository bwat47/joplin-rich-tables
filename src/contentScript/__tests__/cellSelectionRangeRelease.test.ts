import { EditorSelection, EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import type { CellCoords } from '../tableModel/types';
import { endCellDragSelection, setCellDragSelection } from '../tableRuntime/selection/cellSelectionController';
import {
    cellSelectionRangeRelease,
    releaseParkedCellRanges,
} from '../tableRuntime/selection/cellSelectionRangeRelease';
import { cellSelectionScopeGuard } from '../tableRuntime/selection/cellSelectionScopeGuard';
import { clearCellSelectionEffect, getCellSelection } from '../tableState/cellSelectionState';
import { cellSelectionTestExtensions, createEditorViewHarness } from './tableEditorFixtures';

const TABLE = ['| H1 | H2 | H3 |', '| --- | --- | --- |', '| a1 | a2 | a3 |', '| b1 | b2 | b3 |'].join('\n');
const AFTER = 'after';
const DOC = `${TABLE}\n\n${AFTER}`;
const TABLE_SPAN = { from: 0, to: TABLE.length };

const viewHarness = createEditorViewHarness();

function pos(text: string): number {
    return DOC.indexOf(text);
}

function cellRange(text: string) {
    return EditorSelection.range(pos(text), pos(text) + text.length);
}

function body(row: number, col: number): CellCoords {
    return { section: 'body', row, col };
}

/** Lets queued microtasks — the scope guard's clear, then the release — run. */
async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 3; i++) {
        await Promise.resolve();
    }
}

/** Mounts the document with body cells (0,0)–(1,1) selected by a completed drag. */
function mountWithSelection(): EditorView {
    const view = viewHarness.mountView({
        doc: DOC,
        extensions: cellSelectionTestExtensions(
            EditorState.allowMultipleSelections.of(true),
            cellSelectionScopeGuard,
            cellSelectionRangeRelease
        ),
    });
    setCellDragSelection(view, 0, body(0, 0), body(1, 1));
    endCellDragSelection(view, { keepActiveCell: false });
    return view;
}

afterEach(() => {
    viewHarness.destroyViews();
});

describe('releaseParkedCellRanges', () => {
    it('drops ranges inside the table and keeps a main caret outside it', () => {
        const outside = EditorSelection.cursor(pos(AFTER));
        const selection = EditorSelection.create([cellRange('a1'), cellRange('b2'), outside], 2);

        const released = releaseParkedCellRanges(selection, TABLE_SPAN);

        expect(released?.ranges).toEqual([outside]);
    });

    it('collapses a main range inside the table to a caret at its start', () => {
        const selection = EditorSelection.create([cellRange('a1'), cellRange('b2')], 1);

        const released = releaseParkedCellRanges(selection, TABLE_SPAN);

        expect(released?.ranges).toEqual([EditorSelection.cursor(pos('b2'))]);
    });

    it('returns null when no range is parked in the table', () => {
        const selection = EditorSelection.create([EditorSelection.cursor(pos(AFTER))]);

        expect(releaseParkedCellRanges(selection, TABLE_SPAN)).toBeNull();
    });

    it('returns null for a lone caret already inside the table', () => {
        const selection = EditorSelection.create([EditorSelection.cursor(pos('b2'))]);

        expect(releaseParkedCellRanges(selection, TABLE_SPAN)).toBeNull();
    });
});

describe('cell selection range release', () => {
    it('leaves only the new caret after a Ctrl+click outside the table', async () => {
        const view = mountWithSelection();
        const outside = EditorSelection.cursor(pos(AFTER));

        // What CodeMirror dispatches for Ctrl+click: the existing ranges plus a new main caret.
        view.dispatch({ selection: view.state.selection.addRange(outside) });
        await flushMicrotasks();

        expect(getCellSelection(view.state)).toBeNull();
        expect(view.state.selection.ranges).toEqual([outside]);
    });

    it('collapses to a lone caret in the focus cell when the selection is cleared in place', async () => {
        const view = mountWithSelection();

        view.dispatch({ effects: clearCellSelectionEffect.of(null) });
        await flushMicrotasks();

        expect(view.state.selection.ranges).toEqual([EditorSelection.cursor(pos('b2'))]);
    });

    it('keeps the per-cell ranges while the cell selection stands', async () => {
        const view = mountWithSelection();

        await flushMicrotasks();

        expect(view.state.selection.ranges).toHaveLength(4);
    });
});

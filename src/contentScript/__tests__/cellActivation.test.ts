import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCellAtPosition } from '../tableRuntime/cellActivation';
import { activeCellField, getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { createEditorViewHarness } from './tableEditorFixtures';
import { createMarkdownState } from './testMarkdownState';

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| aaa bbb ccc | zzz |'].join('\n');
/** The pipe between the two body cells, which belongs to neither cell. */
const BODY_PIPE_POS = TABLE.indexOf('| zzz');

const viewHarness = createEditorViewHarness();

function createView(): EditorView {
    return viewHarness.mountView({ state: createMarkdownState(TABLE, [activeCellField]) });
}

function cellOf(activeCell: ActiveCell | null) {
    return activeCell && { section: activeCell.section, row: activeCell.row, col: activeCell.col };
}

afterEach(() => {
    viewHarness.destroyViews();
});

describe('activateCellAtPosition on table punctuation', () => {
    it('keeps the current active cell when the position lands on a pipe', () => {
        const editor = createView();
        editor.dispatch({ effects: setActiveCellEffect.of({ tableFrom: 0, section: 'header', row: 0, col: 1 }) });

        expect(activateCellAtPosition(editor, BODY_PIPE_POS, { entryMode: 'enter' })).toBe(true);
        expect(cellOf(getActiveCell(editor.state))).toEqual({ section: 'header', row: 0, col: 1 });
    });

    it('keeps the preferred active cell when the position lands on a pipe', () => {
        const editor = createView();

        activateCellAtPosition(editor, BODY_PIPE_POS, {
            entryMode: 'enter',
            preferredActiveCell: { tableFrom: 0, section: 'header', row: 0, col: 0 },
        });

        expect(cellOf(getActiveCell(editor.state))).toEqual({ section: 'header', row: 0, col: 0 });
    });

    it('falls back to the first body cell when no cell is active', () => {
        const editor = createView();

        activateCellAtPosition(editor, BODY_PIPE_POS, { entryMode: 'enter' });

        expect(cellOf(getActiveCell(editor.state))).toEqual({ section: 'body', row: 0, col: 0 });
    });
});

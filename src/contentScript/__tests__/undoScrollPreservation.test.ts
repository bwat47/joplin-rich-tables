/**
 * @vitest-environment jsdom
 */

import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { vi, type Mock } from 'vitest';
import { activeCellField, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { createUndoScrollPreservation } from '../tableRuntime/undoScrollPreservation';
import { isNestedEditorOpen } from '../nestedEditor/nestedEditorController';

vi.mock('../nestedEditor/nestedEditorController', () => ({
    isNestedEditorOpen: vi.fn(),
}));

const markdownExtension = markdown({
    extensions: [GFM],
});

const TABLE_DOC = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
const mockIsNestedEditorOpen = isNestedEditorOpen as Mock;

function createViewWithActiveCell(activeCell: ActiveCell): EditorView {
    const parent = document.createElement('div');
    document.body.append(parent);

    let view: EditorView;
    view = new EditorView({
        parent,
        extensions: [markdownExtension, activeCellField, createUndoScrollPreservation(() => view)],
        doc: TABLE_DOC,
    });
    view.dispatch({
        effects: setActiveCellEffect.of(activeCell),
    });

    return view;
}

function dispatchUndoEdit(view: EditorView): void {
    const from = view.state.doc.toString().indexOf('a1');
    view.dispatch({
        changes: {
            from,
            to: from + 2,
            insert: 'a',
        },
        userEvent: 'undo',
    });
}

describe('createUndoScrollPreservation', () => {
    beforeEach(() => {
        mockIsNestedEditorOpen.mockReset();
        mockIsNestedEditorOpen.mockReturnValue(true);
    });

    it('preserves scroll for undo in a resolved active cell', () => {
        const view = createViewWithActiveCell({
            tableFrom: 0,
            section: 'body',
            row: 0,
            col: 0,
        });
        const scrollSnapshotSpy = vi.spyOn(view, 'scrollSnapshot');

        dispatchUndoEdit(view);

        expect(scrollSnapshotSpy).toHaveBeenCalledTimes(1);

        view.destroy();
    });

    it('does not preserve scroll for undo when the active cell no longer resolves', () => {
        const view = createViewWithActiveCell({
            tableFrom: 0,
            section: 'body',
            row: 0,
            col: 99,
        });
        const scrollSnapshotSpy = vi.spyOn(view, 'scrollSnapshot');

        dispatchUndoEdit(view);

        expect(scrollSnapshotSpy).not.toHaveBeenCalled();

        view.destroy();
    });
});

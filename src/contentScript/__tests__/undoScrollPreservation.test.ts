/**
 * @jest-environment jsdom
 */

import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { activeCellField, setActiveCellEffect } from '../tableState/activeCellState';
import { createUndoScrollPreservation } from '../tableRuntime/undoScrollPreservation';
import { isNestedEditorOpen } from '../nestedEditor/nestedEditorController';

jest.mock('../nestedEditor/nestedEditorController', () => ({
    isNestedEditorOpen: jest.fn(),
}));

const markdownExtension = markdown({
    extensions: [GFM],
});

const mockIsNestedEditorOpen = isNestedEditorOpen as jest.Mock;

describe('createUndoScrollPreservation', () => {
    beforeEach(() => {
        mockIsNestedEditorOpen.mockReset();
        mockIsNestedEditorOpen.mockReturnValue(true);
    });

    it('preserves scroll for undo in a resolved active cell', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        let view: EditorView;
        view = new EditorView({
            parent,
            extensions: [markdownExtension, activeCellField, createUndoScrollPreservation(() => view)],
            doc: ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'),
        });
        view.dispatch({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 0,
            }),
        });
        const scrollSnapshotSpy = jest.spyOn(view, 'scrollSnapshot');

        view.dispatch({
            changes: {
                from: view.state.doc.toString().indexOf('a1'),
                to: view.state.doc.toString().indexOf('a1') + 2,
                insert: 'a',
            },
            userEvent: 'undo',
        });

        expect(scrollSnapshotSpy).toHaveBeenCalledTimes(1);

        view.destroy();
    });

    it('does not preserve scroll for undo when the active cell no longer resolves', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        let view: EditorView;
        view = new EditorView({
            parent,
            extensions: [markdownExtension, activeCellField, createUndoScrollPreservation(() => view)],
            doc: ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'),
        });
        view.dispatch({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 99,
            }),
        });
        const scrollSnapshotSpy = jest.spyOn(view, 'scrollSnapshot');

        view.dispatch({
            changes: {
                from: view.state.doc.toString().indexOf('a1'),
                to: view.state.doc.toString().indexOf('a1') + 2,
                insert: 'a',
            },
            userEvent: 'undo',
        });

        expect(scrollSnapshotSpy).not.toHaveBeenCalled();

        view.destroy();
    });
});

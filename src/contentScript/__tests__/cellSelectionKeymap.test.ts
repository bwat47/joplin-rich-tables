/**
 * @jest-environment jsdom
 */

const openNestedCellEditorMock = jest.fn();

jest.mock('../nestedEditor/nestedCellEditor', () => ({
    openNestedCellEditor: (...args: unknown[]) => openNestedCellEditorMock.apply(null, args),
}));

jest.mock('../tableWidget/domHelpers', () => ({
    findCellElement: jest.fn(() => ({})),
}));

import { history } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { activeCellField, getActiveCell } from '../tableWidget/activeCellState';
import { setCellSelectionEffect, getCellSelection, cellSelectionField } from '../tableWidget/cellSelectionState';
import { cellSelectionKeyCapturePlugin } from '../tableWidget/cellSelectionKeymap';

const markdownExtension = markdown({
    extensions: [GFM],
});

describe('cellSelectionKeymap', () => {
    beforeEach(() => {
        openNestedCellEditorMock.mockReset();
    });

    it('routes undo through the main editor while a multi-cell selection is active', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        const view = new EditorView({
            parent,
            extensions: [
                markdownExtension,
                history(),
                activeCellField,
                cellSelectionField,
                cellSelectionKeyCapturePlugin,
            ],
            doc: ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'),
        });

        view.dispatch({
            changes: {
                from: view.state.doc.length,
                to: view.state.doc.length,
                insert: '\n| b1 | b2 |',
            },
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'body', row: 1, col: 0 },
                focus: { section: 'body', row: 1, col: 1 },
            }),
        });

        expect(view.state.doc.toString()).toContain('| b1 | b2 |');
        expect(getCellSelection(view.state)).not.toBeNull();

        document.body.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'z',
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
            })
        );

        expect(view.state.doc.toString()).not.toContain('| b1 | b2 |');
        expect(getCellSelection(view.state)).toBeNull();

        view.destroy();
    });

    it('routes Delete through selection removal while a multi-cell selection is active', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        const view = new EditorView({
            parent,
            extensions: [
                markdownExtension,
                history(),
                activeCellField,
                cellSelectionField,
                cellSelectionKeyCapturePlugin,
            ],
            doc: ['| H1 |  | H3 |', '| --- | --- | --- |', '| A1 |  | A3 |', '| B1 |  | B3 |'].join('\n'),
        });

        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'header', row: 0, col: 1 },
                focus: { section: 'body', row: 1, col: 1 },
            }),
        });

        const event = new KeyboardEvent('keydown', {
            key: 'Delete',
            bubbles: true,
            cancelable: true,
        });
        document.body.dispatchEvent(event);

        expect(view.state.doc.toString()).toBe(
            ['| H1 | H3 |', '| --- | --- |', '| A1 | A3 |', '| B1 | B3 |'].join('\n')
        );
        expect(getCellSelection(view.state)).toEqual({
            tableFrom: 0,
            anchor: { section: 'header', row: 0, col: 1 },
            focus: { section: 'body', row: 1, col: 1 },
        });

        view.destroy();
    });

    it('routes Backspace through selection removal while a multi-cell selection is active', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        const view = new EditorView({
            parent,
            extensions: [
                markdownExtension,
                history(),
                activeCellField,
                cellSelectionField,
                cellSelectionKeyCapturePlugin,
            ],
            doc: ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'),
        });

        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'body', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });

        const event = new KeyboardEvent('keydown', {
            key: 'Backspace',
            bubbles: true,
            cancelable: true,
        });
        document.body.dispatchEvent(event);

        expect(view.state.doc.toString()).toBe(['| H1 | H2 |', '| --- | --- |', '|  |  |'].join('\n'));
        expect(getCellSelection(view.state)).toEqual({
            tableFrom: 0,
            anchor: { section: 'body', row: 0, col: 0 },
            focus: { section: 'body', row: 0, col: 1 },
        });

        view.destroy();
    });

    it('ignores Delete when multi-cell selection mode is not active', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        const initialDoc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const view = new EditorView({
            parent,
            extensions: [
                markdownExtension,
                history(),
                activeCellField,
                cellSelectionField,
                cellSelectionKeyCapturePlugin,
            ],
            doc: initialDoc,
        });

        const event = new KeyboardEvent('keydown', {
            key: 'Delete',
            bubbles: true,
            cancelable: true,
        });
        document.body.dispatchEvent(event);

        expect(view.state.doc.toString()).toBe(initialDoc);
        expect(getCellSelection(view.state)).toBeNull();

        view.destroy();
    });

    it('activates the focus cell editor on Tab while multi-cell selection is active', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        const view = new EditorView({
            parent,
            extensions: [markdownExtension, activeCellField, cellSelectionField, cellSelectionKeyCapturePlugin],
            doc: ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'),
        });

        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'body', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });

        const event = new KeyboardEvent('keydown', {
            key: 'Tab',
            bubbles: true,
            cancelable: true,
        });
        document.body.dispatchEvent(event);

        expect(getCellSelection(view.state)).toBeNull();
        expect(getActiveCell(view.state)).toMatchObject({
            tableFrom: 0,
            section: 'body',
            row: 0,
            col: 1,
        });
        expect(openNestedCellEditorMock).toHaveBeenCalledTimes(1);

        view.destroy();
    });
});

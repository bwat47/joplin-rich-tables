/**
 * @vitest-environment jsdom
 */

vi.mock('../tableWidget/domHelpers', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../tableWidget/domHelpers')>()),
    findCellElement: vi.fn(() => ({})),
}));

import { history } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { activeCellField, getActiveCell, setActiveCellEffect } from '../tableState/activeCellState';
import { setCellSelectionEffect, getCellSelection, cellSelectionField } from '../tableState/cellSelectionState';
import { startCellSelectionFromActiveCell } from '../tableRuntime/selection/cellSelectionController';
import { cellSelectionKeyCapturePlugin } from '../tableRuntime/selection/cellSelectionKeymap';
import { triggerOpenCellRequestEffect } from '../tableRuntime/openCellRequest';

const markdownExtension = markdown({
    extensions: [GFM],
});

describe('cellSelectionKeymap', () => {
    it('routes undo through the main editor while a multi-cell selection is active', () => {
        const parent = document.createElement('div');
        document.body.append(parent);

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
        document.body.append(parent);

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
        document.body.append(parent);

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

    it('focuses the main editor after deleting an emptied table via multi-cell selection', () => {
        const parent = document.createElement('div');
        document.body.append(parent);

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
        const focusSpy = vi.spyOn(view, 'focus');

        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'header', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });

        document.body.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Delete',
                bubbles: true,
                cancelable: true,
            })
        );

        expect(view.state.doc.toString()).toBe(['|  |  |', '| --- | --- |', '|  |  |'].join('\n'));
        expect(getCellSelection(view.state)).toEqual({
            tableFrom: 0,
            anchor: { section: 'header', row: 0, col: 0 },
            focus: { section: 'body', row: 0, col: 1 },
        });

        focusSpy.mockClear();

        document.body.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Delete',
                bubbles: true,
                cancelable: true,
            })
        );

        expect(view.state.doc.toString()).toBe('');
        expect(getCellSelection(view.state)).toBeNull();
        expect(view.state.selection.main.anchor).toBe(0);
        expect(focusSpy).toHaveBeenCalledTimes(1);

        view.destroy();
    });

    it('ignores Delete when multi-cell selection mode is not active', () => {
        const parent = document.createElement('div');
        document.body.append(parent);

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
        document.body.append(parent);

        const view = new EditorView({
            parent,
            extensions: [markdownExtension, activeCellField, cellSelectionField, cellSelectionKeyCapturePlugin],
            doc: ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'),
        });

        const dispatchSpy = vi.spyOn(view, 'dispatch');
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
        const lastSpec = dispatchSpy.mock.calls.at(-1)?.[0];
        const effects = Array.isArray(lastSpec?.effects) ? lastSpec.effects : [lastSpec?.effects];
        expect(effects.some((effect) => effect?.is?.(triggerOpenCellRequestEffect))).toBe(true);

        view.destroy();
    });

    it('starts cell selection from a resolved active cell', () => {
        const parent = document.createElement('div');
        document.body.append(parent);

        const view = new EditorView({
            parent,
            extensions: [markdownExtension, activeCellField, cellSelectionField],
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

        expect(startCellSelectionFromActiveCell(view, 'right')).toBe(true);
        expect(getActiveCell(view.state)).toBeNull();
        expect(getCellSelection(view.state)).toEqual({
            tableFrom: 0,
            anchor: { section: 'body', row: 0, col: 0 },
            focus: { section: 'body', row: 0, col: 1 },
        });

        view.destroy();
    });

    it('does not start cell selection from a stale active cell', () => {
        const parent = document.createElement('div');
        document.body.append(parent);

        const view = new EditorView({
            parent,
            extensions: [markdownExtension, activeCellField, cellSelectionField],
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
        const dispatchSpy = vi.spyOn(view, 'dispatch');

        expect(startCellSelectionFromActiveCell(view, 'right')).toBe(false);
        expect(dispatchSpy).not.toHaveBeenCalled();
        expect(getCellSelection(view.state)).toBeNull();

        view.destroy();
    });
});

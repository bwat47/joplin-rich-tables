/**
 * @vitest-environment jsdom
 */

import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { defaultHostEditorConfig } from '../../contentScriptBridge/hostEditorConfigBridge';
import { openNestedEditor, nestedEditorPlugin } from '../nestedEditor/nestedEditorController';
import { resolvedActiveCellField } from '../tableRuntime/activeCell/resolvedActiveCell';
import { activeCellField, getActiveCell, setActiveCellEffect } from '../tableState/activeCellState';

const markdownExtension = markdown({
    extensions: [GFM],
});

describe('nested editor navigation', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('flushes pending nested-editor text before Tab inserts a new row from the last cell', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        const mainView = new EditorView({
            parent,
            extensions: [markdownExtension, activeCellField, resolvedActiveCellField, nestedEditorPlugin],
            doc: ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'),
        });

        mainView.dispatch({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 1,
            }),
        });

        const cellElement = document.createElement('td');
        document.body.appendChild(cellElement);

        if (!getActiveCell(mainView.state)) {
            throw new Error('Expected active cell to be set');
        }

        openNestedEditor({
            mainView,
            cellElement,
            featureSettings: defaultHostEditorConfig().nestedEditor,
        });

        const controller = (mainView.plugin(nestedEditorPlugin) as { controller: unknown } | null)?.controller as
            | {
                  session: {
                      editor: EditorView;
                      local: { text: string; selection: { anchor: number; head: number } };
                  } | null;
              }
            | undefined;

        const nestedView = controller?.session?.editor;
        if (!controller?.session || !nestedView) {
            throw new Error('Expected nested editor session to be open');
        }

        controller.session.local = {
            text: 'a2x',
            selection: { anchor: 3, head: 3 },
        };

        nestedView.contentDOM.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Tab',
                bubbles: true,
                cancelable: true,
            })
        );

        expect(mainView.state.doc.toString()).toContain('| a1 | a2x |');
        expect(mainView.state.doc.toString()).toContain('\n|  |  |');
        expect(getActiveCell(mainView.state)).toMatchObject({
            tableFrom: 0,
            section: 'body',
            row: 1,
            col: 0,
        });

        mainView.destroy();
    });

    it('mirrors right-click position to the main editor without moving the nested selection', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        const mainView = new EditorView({
            parent,
            extensions: [markdownExtension, activeCellField, resolvedActiveCellField, nestedEditorPlugin],
            doc: ['| H1 | H2 |', '| --- | --- |', '| misspelled | other |'].join('\n'),
        });

        mainView.dispatch({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 0,
            }),
        });

        const cellElement = document.createElement('td');
        document.body.appendChild(cellElement);

        openNestedEditor({
            mainView,
            cellElement,
            featureSettings: defaultHostEditorConfig().nestedEditor,
        });

        const controller = (mainView.plugin(nestedEditorPlugin) as { controller: unknown } | null)?.controller as
            | {
                  session: {
                      resolvedCell: { editableFrom: number };
                      editor: EditorView;
                  } | null;
                  syncSelectionToMain: (nestedView: EditorView, event?: MouseEvent) => void;
              }
            | undefined;

        const nestedView = controller?.session?.editor;
        if (!controller?.session || !nestedView) {
            throw new Error('Expected nested editor session to be open');
        }

        const initialNestedSelection = nestedView.state.selection.main;
        const clickedLocalPos = 4;
        const nestedDispatchSpy = vi.spyOn(nestedView, 'dispatch');
        vi.spyOn(nestedView, 'posAtCoords').mockReturnValue(clickedLocalPos);

        controller.syncSelectionToMain(
            nestedView,
            new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                button: 2,
                clientX: 24,
                clientY: 12,
            })
        );

        expect(nestedDispatchSpy).not.toHaveBeenCalled();
        expect(nestedView.state.selection.main).toEqual(initialNestedSelection);
        expect(mainView.state.selection.main.anchor).toBe(
            controller.session.resolvedCell.editableFrom + clickedLocalPos
        );
        expect(mainView.state.selection.main.head).toBe(controller.session.resolvedCell.editableFrom + clickedLocalPos);

        mainView.destroy();
    });

    it('does not open when no current active cell resolves', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        const mainView = new EditorView({
            parent,
            extensions: [markdownExtension, activeCellField, resolvedActiveCellField, nestedEditorPlugin],
            doc: ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'),
        });

        const cellElement = document.createElement('td');
        document.body.appendChild(cellElement);

        expect(
            openNestedEditor({
                mainView,
                cellElement,
                featureSettings: defaultHostEditorConfig().nestedEditor,
            })
        ).toBe(false);

        mainView.destroy();
    });
});

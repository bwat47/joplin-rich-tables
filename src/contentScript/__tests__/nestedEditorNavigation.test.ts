/**
 * @jest-environment jsdom
 */

import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { defaultNestedEditorFeatureSettings } from '../../contentScriptBridge/editorSettingsBridge';
import { documentDefinitionsField } from '../services/documentDefinitions';
import { openNestedEditor, nestedEditorPlugin } from '../nestedEditor/nestedEditorController';
import { resolvedActiveCellField } from '../tableRuntime/activeCell/resolvedActiveCell';
import { activeCellField, getActiveCell, setActiveCellEffect } from '../tableState/activeCellState';

const markdownExtension = markdown({
    extensions: [GFM],
});

describe('nested editor navigation', () => {
    it('flushes pending nested-editor text before Tab inserts a new row from the last cell', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        const mainView = new EditorView({
            parent,
            extensions: [
                markdownExtension,
                activeCellField,
                resolvedActiveCellField,
                documentDefinitionsField,
                nestedEditorPlugin,
            ],
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
            featureSettings: defaultNestedEditorFeatureSettings(),
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
                featureSettings: defaultNestedEditorFeatureSettings(),
            })
        ).toBe(false);

        mainView.destroy();
    });
});

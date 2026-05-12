/** @jest-environment jsdom */

import { EditorView } from '@codemirror/view';
import { describe, expect, it, afterEach, jest } from '@jest/globals';
import { markdownRenderServiceFacet, type MarkdownRenderService } from '../services/markdownRenderer';
import { activeCellField, setActiveCellEffect } from '../tableState/activeCellState';
import { closeNestedEditor, nestedEditorPlugin, openNestedEditor } from '../nestedEditor/nestedEditorController';
import { createMarkdownState } from './testMarkdownState';

describe('nestedEditorController markdown rendering', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('uses the markdown renderer supplied by the editor state facet when closing', () => {
        const tableText = ['| H1 |', '| --- |', '| **body** |'].join('\n');
        const renderer: MarkdownRenderService = {
            getCached: jest.fn(() => '<p><strong>cached</strong></p>'),
            renderAsync: jest.fn(),
            clear: jest.fn(),
        };
        let state = createMarkdownState(tableText, [
            activeCellField,
            markdownRenderServiceFacet.of(renderer),
            nestedEditorPlugin,
        ]);
        state = state.update({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 0,
            }),
        }).state;

        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({ parent, state });
        const cellElement = document.createElement('td');
        cellElement.textContent = '**body**';
        parent.appendChild(cellElement);

        expect(
            openNestedEditor({
                mainView: view,
                cellElement,
                featureSettings: { autoMatchingBraces: true },
            })
        ).toBe(true);

        closeNestedEditor(view);

        expect(renderer.getCached).toHaveBeenCalledWith('**body**');
        expect(cellElement.querySelector('div')?.innerHTML).toBe('<p><strong>cached</strong></p>');

        view.destroy();
    });
});

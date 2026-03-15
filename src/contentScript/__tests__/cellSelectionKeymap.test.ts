/**
 * @jest-environment jsdom
 */

import { history } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { setCellSelectionEffect, getCellSelection, cellSelectionField } from '../tableWidget/cellSelectionState';
import { cellSelectionKeyCapturePlugin } from '../tableWidget/cellSelectionKeymap';

describe('cellSelectionKeymap', () => {
    it('routes undo through the main editor while a multi-cell selection is active', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        const view = new EditorView({
            parent,
            extensions: [history(), cellSelectionField, cellSelectionKeyCapturePlugin],
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
});

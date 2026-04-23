/**
 * @jest-environment jsdom
 */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { EditorSelection, EditorState } from '@codemirror/state';
import { drawSelection, EditorView } from '@codemirror/view';
import { createNestedEditorDomHandlers } from '../nestedEditor/domHandlers';

if (!Range.prototype.getClientRects) {
    Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value: () => [],
    });
}

if (!Range.prototype.getBoundingClientRect) {
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => new DOMRect(),
    });
}

function createNestedView(params: { parent: HTMLElement; syncSelectionToMain: jest.Mock }) {
    return new EditorView({
        parent: params.parent,
        state: EditorState.create({
            doc: 'selected text',
            selection: EditorSelection.single(0, 'selected'.length),
            extensions: [
                drawSelection(),
                ...createNestedEditorDomHandlers({} as EditorView, {
                    syncSelectionToMain: params.syncSelectionToMain,
                    closeEditor: jest.fn(),
                    ensureRootSelectionForCommand: jest.fn(),
                }),
            ],
        }),
    });
}

describe('nestedEditor dom handlers', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('stops left-clicks inside selected text from bubbling to the parent editor', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        const parentMouseDown = jest.fn();
        parent.addEventListener('mousedown', parentMouseDown);

        const syncSelectionToMain = jest.fn();
        const nestedView = createNestedView({ parent, syncSelectionToMain });
        const selectionTarget = nestedView.dom.querySelector('.cm-selectionBackground') as HTMLElement | null;

        (selectionTarget ?? nestedView.contentDOM).dispatchEvent(
            new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                button: 0,
            })
        );

        expect(parentMouseDown).not.toHaveBeenCalled();
        expect(syncSelectionToMain).not.toHaveBeenCalled();

        nestedView.destroy();
    });

    it('keeps right-click selection sync while still blocking parent-editor mousedown handlers', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        const parentMouseDown = jest.fn();
        parent.addEventListener('mousedown', parentMouseDown);

        const syncSelectionToMain = jest.fn();
        const nestedView = createNestedView({ parent, syncSelectionToMain });
        const selectionTarget = nestedView.dom.querySelector('.cm-selectionBackground') as HTMLElement | null;

        (selectionTarget ?? nestedView.contentDOM).dispatchEvent(
            new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                button: 2,
                clientX: 24,
                clientY: 12,
            })
        );

        expect(syncSelectionToMain).toHaveBeenCalledTimes(1);
        expect(parentMouseDown).not.toHaveBeenCalled();

        nestedView.destroy();
    });
});

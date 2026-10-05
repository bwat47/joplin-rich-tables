import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createNestedEditorDomHandlers } from '../nestedEditor/domHandlers';
import { installRangeLayoutStubs } from './tableEditorFixtures';

installRangeLayoutStubs();

function dispatchMouseDown(target: HTMLElement, init: MouseEventInit): void {
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, ...init }));
}

function createNestedView(params: { parent: HTMLElement; syncSelectionToMain: Mock }) {
    return new EditorView({
        parent: params.parent,
        state: EditorState.create({
            doc: 'selected text',
            selection: EditorSelection.single(0, 'selected'.length),
            extensions: [
                ...createNestedEditorDomHandlers({
                    syncSelectionToMain: params.syncSelectionToMain,
                    ensureRootSelectionForCommand: vi.fn(),
                }),
            ],
        }),
    });
}

describe('nestedEditor dom handlers', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('stops left-clicks on nested editor text from bubbling to the parent editor', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        const parentMouseDown = vi.fn();
        parent.addEventListener('mousedown', parentMouseDown);

        const syncSelectionToMain = vi.fn();
        const nestedView = createNestedView({ parent, syncSelectionToMain });
        // The nested editor draws no selection overlay, so a press lands on the text itself.
        dispatchMouseDown(nestedView.contentDOM, { button: 0 });

        expect(parentMouseDown).not.toHaveBeenCalled();
        expect(syncSelectionToMain).not.toHaveBeenCalled();

        nestedView.destroy();
    });

    it('keeps right-click selection sync while still blocking parent-editor mousedown handlers', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        const parentMouseDown = vi.fn();
        parent.addEventListener('mousedown', parentMouseDown);

        const syncSelectionToMain = vi.fn();
        const nestedView = createNestedView({ parent, syncSelectionToMain });
        dispatchMouseDown(nestedView.contentDOM, { button: 2, clientX: 24, clientY: 12 });

        expect(syncSelectionToMain).toHaveBeenCalledTimes(1);
        expect(parentMouseDown).not.toHaveBeenCalled();

        nestedView.destroy();
    });

    it('selects the entire cell on Mod-a', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const nestedView = createNestedView({ parent, syncSelectionToMain: vi.fn() });

        nestedView.contentDOM.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })
        );

        expect(nestedView.state.selection.main).toMatchObject({ from: 0, to: nestedView.state.doc.length });
        nestedView.destroy();
    });
});

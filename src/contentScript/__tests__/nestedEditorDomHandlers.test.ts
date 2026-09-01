/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { drawSelection, EditorView } from '@codemirror/view';
import { createNestedEditorDomHandlers } from '../nestedEditor/domHandlers';
import { handleTableClipboardTextPaste } from '../tableRuntime/selection/cellSelectionClipboard';

vi.mock('../tableRuntime/selection/cellSelectionClipboard', () => ({
    handleTableClipboardTextPaste: vi.fn(() => false),
}));

const handleTableClipboardTextPasteMock = vi.mocked(handleTableClipboardTextPaste);

function dispatchPaste(target: HTMLElement, text: string): void {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
        value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    });
    target.dispatchEvent(event);
}

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

function createNestedView(params: { parent: HTMLElement; syncSelectionToMain: Mock }) {
    return new EditorView({
        parent: params.parent,
        state: EditorState.create({
            doc: 'selected text',
            selection: EditorSelection.single(0, 'selected'.length),
            extensions: [
                drawSelection(),
                ...createNestedEditorDomHandlers({} as EditorView, {
                    syncSelectionToMain: params.syncSelectionToMain,
                    closeEditor: vi.fn(),
                    ensureRootSelectionForCommand: vi.fn(),
                }),
            ],
        }),
    });
}

describe('nestedEditor dom handlers', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        handleTableClipboardTextPasteMock.mockReset();
        handleTableClipboardTextPasteMock.mockReturnValue(false);
    });

    it('stops left-clicks inside selected text from bubbling to the parent editor', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        const parentMouseDown = vi.fn();
        parent.addEventListener('mousedown', parentMouseDown);

        const syncSelectionToMain = vi.fn();
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

        const parentMouseDown = vi.fn();
        parent.addEventListener('mousedown', parentMouseDown);

        const syncSelectionToMain = vi.fn();
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

    it('routes a table fragment pasted into the nested editor through the multi-cell rewrite', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const nestedView = createNestedView({ parent, syncSelectionToMain: vi.fn() });
        handleTableClipboardTextPasteMock.mockReturnValue(true);

        const clipboardText = ['| P1 | P2 |', '| --- | --- |', '| Q1 | Q2 |'].join('\n');
        dispatchPaste(nestedView.contentDOM, clipboardText);

        expect(handleTableClipboardTextPasteMock).toHaveBeenCalledWith(clipboardText, expect.anything(), {
            nestedEditorOpen: true,
        });
        // The rewrite owns the paste, so nothing lands in the cell editor itself.
        expect(nestedView.state.doc.toString()).toBe('selected text');

        nestedView.destroy();
    });

    it('lets a non-table paste fall through to the nested editor', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const nestedView = createNestedView({ parent, syncSelectionToMain: vi.fn() });

        dispatchPaste(nestedView.contentDOM, 'plain');

        expect(handleTableClipboardTextPasteMock).toHaveBeenCalledTimes(1);
        expect(nestedView.state.doc.toString()).toBe('plain text');

        nestedView.destroy();
    });
});

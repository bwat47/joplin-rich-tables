/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { forceRootDomSelection } from '../editorBridge/rootDomSelection';

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

function createView(doc: string): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    return new EditorView({
        parent,
        state: EditorState.create({
            doc,
            selection: EditorSelection.single(0),
        }),
    });
}

function getSelectionPositions(view: EditorView): { anchor: number; head: number } {
    const selection = document.getSelection();
    if (!selection?.anchorNode || !selection.focusNode) {
        throw new Error('Expected DOM selection');
    }

    return {
        anchor: view.posAtDOM(selection.anchorNode, selection.anchorOffset),
        head: view.posAtDOM(selection.focusNode, selection.focusOffset),
    };
}

describe('forceRootDomSelection', () => {
    afterEach(() => {
        document.getSelection()?.removeAllRanges();
        document.body.innerHTML = '';
    });

    it('writes the browser DOM selection for a forward editor selection', () => {
        const view = createView('abcdef');

        expect(forceRootDomSelection(view, { anchor: 2, head: 5 })).toBe(true);
        expect(getSelectionPositions(view)).toEqual({ anchor: 2, head: 5 });

        view.destroy();
    });

    it('preserves backward selection direction when the DOM API supports it', () => {
        const view = createView('abcdef');

        expect(forceRootDomSelection(view, { anchor: 5, head: 2 })).toBe(true);
        expect(getSelectionPositions(view)).toEqual({ anchor: 5, head: 2 });

        view.destroy();
    });
});

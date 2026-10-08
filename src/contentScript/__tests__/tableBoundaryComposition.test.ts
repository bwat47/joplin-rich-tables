import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markdownRenderServiceFacet } from '../services/markdownRenderer';
import { tableBoundaryMaintenanceExtension } from '../tableRuntime/boundaries/tableBoundaryMaintenance';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { createResizeObserverStub, installRangeLayoutStubs } from './tableEditorFixtures';
import { createMarkdownState } from './testMarkdownState';
import { htmlFragment } from './testUtils';

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
const resizeObserver = createResizeObserverStub();
let view: EditorView | null = null;

installRangeLayoutStubs();

describe('composition next to a rendered table', () => {
    beforeEach(() => {
        resizeObserver.install();
    });

    afterEach(() => {
        view?.destroy();
        view = null;
        document.body.replaceChildren();
        vi.unstubAllGlobals();
    });

    it('keeps DOM text and selection aligned through composition below the table', async () => {
        const doc = `\n${TABLE}\n`;
        const parent = document.body.appendChild(document.createElement('div'));
        const editor = new EditorView({
            parent,
            state: createMarkdownState(doc, [
                markdownRenderServiceFacet.of({
                    getCached: () => undefined,
                    render: async () => htmlFragment(''),
                    clear: () => {},
                }),
                tableBoundaryMaintenanceExtension,
                tableDecorationField,
            ]),
        });
        view = editor;
        editor.dispatch({ selection: { anchor: doc.length } });
        editor.focus();
        editor.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));

        const line = editor.contentDOM.querySelector('.cm-line:last-child');
        expect(line).not.toBeNull();
        let composingText = document.createTextNode('h');
        line?.replaceChildren(composingText);
        document.getSelection()?.setBaseAndExtent(composingText, 1, composingText, 1);
        editor.contentDOM.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));

        await vi.waitFor(() => {
            expect(editor.state.doc.toString()).toBe(`\n${TABLE}\n\nh`);
            expect(editor.state.selection.main.head).toBe(editor.state.doc.length);
            expect(editor.contentDOM.querySelector('.cm-line:last-child')?.textContent).toBe('h');
            const selection = document.getSelection();
            expect(selection?.focusNode?.textContent).toBe('h');
            expect(selection?.focusOffset).toBe(1);
            expect(editor.posAtDOM(selection!.focusNode!, selection!.focusOffset)).toBe(editor.state.doc.length);
        });

        // Continue from the current DOM selection after CodeMirror has applied the padding.
        composingText = editor.contentDOM.querySelector('.cm-line:last-child')!.firstChild as Text;
        expect(composingText.nodeType).toBe(Node.TEXT_NODE);
        composingText.nodeValue = 'hello';
        document.getSelection()?.setBaseAndExtent(composingText, 5, composingText, 5);
        editor.contentDOM.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));

        await vi.waitFor(() => {
            expect(editor.state.doc.toString()).toBe(`\n${TABLE}\n\nhello`);
            expect(editor.state.selection.main.head).toBe(editor.state.doc.length);
            expect(editor.contentDOM.contains(composingText)).toBe(true);
            expect(document.getSelection()?.focusNode).toBe(composingText);
            expect(document.getSelection()?.focusOffset).toBe(5);
            expect(editor.posAtDOM(composingText, 5)).toBe(editor.state.doc.length);
        });

        editor.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'hello' }));
        await vi.waitFor(() => {
            expect(editor.compositionStarted).toBe(false);
            expect(editor.state.doc.toString()).toBe(`\n${TABLE}\n\nhello`);
            expect(editor.contentDOM.querySelector('.cm-line:last-child')?.textContent).toBe('hello');
            expect(editor.state.selection.main.head).toBe(editor.state.doc.length);
        });
    });
});

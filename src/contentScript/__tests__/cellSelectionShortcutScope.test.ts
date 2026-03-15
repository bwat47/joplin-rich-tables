/**
 * @jest-environment jsdom
 */

import { EditorView } from '@codemirror/view';
import { createMarkdownState } from './testMarkdownState';
import { cellSelectionField, setCellSelectionEffect } from '../tableWidget/cellSelectionState';
import { canHandleTableSelectionShortcut } from '../tableWidget/cellSelectionShortcutScope';
import { CLASS_FLOATING_TOOLBAR, CLASS_TABLE_WIDGET } from '../tableWidget/domHelpers';

function createViewHarness() {
    let state = createMarkdownState('| H1 |\n| --- |\n| a |', [cellSelectionField]);
    state = state.update({
        effects: setCellSelectionEffect.of({
            tableFrom: 0,
            anchor: { section: 'header', row: 0, col: 0 },
            focus: { section: 'body', row: 0, col: 0 },
        }),
    }).state;

    const root = document.createElement('div');
    const scrollDOM = document.createElement('div');
    const contentDOM = document.createElement('div');
    const selectedWidget = document.createElement('div');
    const selectedWidgetChild = document.createElement('span');
    selectedWidget.className = CLASS_TABLE_WIDGET;
    selectedWidget.appendChild(selectedWidgetChild);
    contentDOM.appendChild(selectedWidget);
    root.appendChild(scrollDOM);
    root.appendChild(contentDOM);
    document.body.appendChild(root);

    const view = {
        state,
        dom: root,
        scrollDOM,
        contentDOM,
        posAtDOM: jest.fn((node: Node) => (node === selectedWidget ? 0 : 1)),
    } as unknown as EditorView;

    return { view, root, scrollDOM, contentDOM, selectedWidget, selectedWidgetChild };
}

function setActiveElement(element: Element | null): void {
    Object.defineProperty(document, 'activeElement', {
        configurable: true,
        get: () => element,
    });
}

describe('cellSelectionShortcutScope', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        setActiveElement(document.body);
    });

    it('allows shortcuts when focus is on the document body', () => {
        const { view } = createViewHarness();
        setActiveElement(document.body);

        expect(canHandleTableSelectionShortcut(view)).toBe(true);
    });

    it('allows shortcuts when focus is inside the selected table widget', () => {
        const { view, selectedWidgetChild } = createViewHarness();
        setActiveElement(selectedWidgetChild);

        expect(canHandleTableSelectionShortcut(view)).toBe(true);
    });

    it('rejects shortcuts when focus is on a toolbar button', () => {
        const { view, root } = createViewHarness();
        const toolbar = document.createElement('div');
        toolbar.className = CLASS_FLOATING_TOOLBAR;
        const button = document.createElement('button');
        toolbar.appendChild(button);
        root.appendChild(toolbar);
        setActiveElement(button);

        expect(canHandleTableSelectionShortcut(view)).toBe(false);
    });

    it('rejects shortcuts when focus is on another interactive control in the editor', () => {
        const { view, root } = createViewHarness();
        const button = document.createElement('button');
        root.appendChild(button);
        setActiveElement(button);

        expect(canHandleTableSelectionShortcut(view)).toBe(false);
    });
});

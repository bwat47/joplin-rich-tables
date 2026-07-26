/**
 * @vitest-environment jsdom
 */

import { EditorView } from '@codemirror/view';
import { createMarkdownState } from './testMarkdownState';
import { activeCellField, setActiveCellEffect } from '../tableState/activeCellState';
import { cellSelectionField, setCellSelectionEffect } from '../tableState/cellSelectionState';
import {
    canHandleTableClipboardShortcut,
    canHandleTableSelectionKeydown,
} from '../tableRuntime/selection/cellSelectionShortcutScope';
import { CLASS_CELL_EDITOR } from '../shared/tableDomClasses';
import { CLASS_FLOATING_TOOLBAR, CLASS_TABLE_WIDGET } from '../tableWidget/domHelpers';

function createViewHarness() {
    let state = createMarkdownState('| H1 |\n| --- |\n| a |', [activeCellField, cellSelectionField]);
    state = state.update({
        effects: [
            setActiveCellEffect.of({
                tableFrom: 0,
                section: 'header',
                row: 0,
                col: 0,
            }),
            setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'header', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 0 },
            }),
        ],
    }).state;

    const root = document.createElement('div');
    const scrollDOM = document.createElement('div');
    const contentDOM = document.createElement('div');
    const selectedWidget = document.createElement('div');
    const selectedWidgetChild = document.createElement('span');
    selectedWidget.className = CLASS_TABLE_WIDGET;
    selectedWidget.append(selectedWidgetChild);
    contentDOM.append(selectedWidget);
    root.append(scrollDOM);
    root.append(contentDOM);
    document.body.append(root);

    const view = {
        state,
        dom: root,
        scrollDOM,
        contentDOM,
        posAtDOM: vi.fn((node: Node) => (node === selectedWidget ? 0 : 1)),
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
        document.body.replaceChildren();
        setActiveElement(document.body);
    });

    it('allows shortcuts when focus is on the document body', () => {
        const { view } = createViewHarness();
        setActiveElement(document.body);

        expect(canHandleTableSelectionKeydown(view)).toBe(true);
    });

    it('allows shortcuts when focus is inside the selected table widget', () => {
        const { view, selectedWidgetChild } = createViewHarness();
        setActiveElement(selectedWidgetChild);

        expect(canHandleTableSelectionKeydown(view)).toBe(true);
    });

    it('rejects shortcuts when focus is on a toolbar button', () => {
        const { view, root } = createViewHarness();
        const toolbar = document.createElement('div');
        toolbar.className = CLASS_FLOATING_TOOLBAR;
        const button = document.createElement('button');
        toolbar.append(button);
        root.append(toolbar);
        setActiveElement(button);

        expect(canHandleTableSelectionKeydown(view)).toBe(false);
    });

    it('rejects shortcuts when focus is on another interactive control in the editor', () => {
        const { view, root } = createViewHarness();
        const button = document.createElement('button');
        root.append(button);
        setActiveElement(button);

        expect(canHandleTableSelectionKeydown(view)).toBe(false);
    });

    it('allows clipboard shortcuts when focus is inside the nested editor', () => {
        const { view, root } = createViewHarness();
        const editorHost = document.createElement('div');
        editorHost.className = CLASS_CELL_EDITOR;
        const nestedContent = document.createElement('div');
        nestedContent.setAttribute('contenteditable', 'true');
        editorHost.append(nestedContent);
        root.append(editorHost);
        setActiveElement(nestedContent);

        expect(canHandleTableClipboardShortcut(view)).toBe(true);
    });
});

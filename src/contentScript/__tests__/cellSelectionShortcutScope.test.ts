/**
 * @vitest-environment jsdom
 */

import { EditorView } from '@codemirror/view';
import { createMarkdownState } from './testMarkdownState';
import { activeCellField, setActiveCellEffect } from '../tableState/activeCellState';
import { cellSelectionField, clearCellSelectionEffect, setCellSelectionEffect } from '../tableState/cellSelectionState';
import { cellDragField, isCellDragInProgress, startCellDragEffect } from '../tableState/cellDragState';
import {
    canHandleTableClipboardShortcut,
    canHandleTableSelectionKeydown,
} from '../tableRuntime/selection/cellSelectionShortcutScope';
import { CLASS_CELL_EDITOR } from '../shared/tableDomClasses';
import { CLASS_FLOATING_TOOLBAR, CLASS_TABLE_WIDGET } from '../tableWidget/domHelpers';

function createViewHarness(options: { activeCell?: boolean; selection?: boolean; dragging?: boolean } = {}) {
    const { activeCell = true, selection = true, dragging = false } = options;
    let state = createMarkdownState('| H1 |\n| --- |\n| a |', [activeCellField, cellSelectionField, cellDragField]);
    state = state.update({
        effects: [
            ...(activeCell
                ? [
                      setActiveCellEffect.of({
                          tableFrom: 0,
                          section: 'header' as const,
                          row: 0,
                          col: 0,
                      }),
                  ]
                : []),
            ...(selection
                ? [
                      setCellSelectionEffect.of({
                          tableFrom: 0,
                          anchor: { section: 'header' as const, row: 0, col: 0 },
                          focus: { section: 'body' as const, row: 0, col: 0 },
                      }),
                  ]
                : []),
            ...(dragging ? [startCellDragEffect.of(undefined)] : []),
        ],
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
        document.body.innerHTML = '';
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
        toolbar.appendChild(button);
        root.appendChild(toolbar);
        setActiveElement(button);

        expect(canHandleTableSelectionKeydown(view)).toBe(false);
    });

    it('rejects shortcuts when focus is on another interactive control in the editor', () => {
        const { view, root } = createViewHarness();
        const button = document.createElement('button');
        root.appendChild(button);
        setActiveElement(button);

        expect(canHandleTableSelectionKeydown(view)).toBe(false);
    });

    it('leaves selection keys with the nested editor while allowing table-aware clipboard handling', () => {
        const { view, root } = createViewHarness();
        const editorHost = document.createElement('div');
        editorHost.className = CLASS_CELL_EDITOR;
        const nestedContent = document.createElement('div');
        nestedContent.setAttribute('contenteditable', 'true');
        editorHost.appendChild(nestedContent);
        root.appendChild(editorHost);
        setActiveElement(nestedContent);

        expect(canHandleTableClipboardShortcut(view)).toBe(true);
        expect(canHandleTableSelectionKeydown(view)).toBe(true);
    });

    it('withholds selection keys while a mouse drag owns the table', () => {
        const { view } = createViewHarness({ dragging: true });
        setActiveElement(document.body);

        expect(canHandleTableClipboardShortcut(view)).toBe(true);
        expect(canHandleTableSelectionKeydown(view)).toBe(false);
    });

    it.each([
        { label: 'the selection is cleared', effect: () => clearCellSelectionEffect.of(undefined) },
        {
            label: 'a cell is activated',
            effect: () => setActiveCellEffect.of({ tableFrom: 0, section: 'header' as const, row: 0, col: 0 }),
        },
    ])('ends the drag once $label and does not revive it for a later selection', ({ effect }) => {
        let state = createMarkdownState('| H1 |\n| --- |\n| a |', [activeCellField, cellSelectionField, cellDragField]);
        const selection = {
            tableFrom: 0,
            anchor: { section: 'header' as const, row: 0, col: 0 },
            focus: { section: 'body' as const, row: 0, col: 0 },
        };
        state = state.update({
            effects: [setCellSelectionEffect.of(selection), startCellDragEffect.of(undefined)],
        }).state;
        expect(isCellDragInProgress(state)).toBe(true);

        // The gesture cannot always dispatch its own end, so the drag must not survive the
        // selection it belongs to.
        state = state.update({ effects: effect() }).state;

        expect(state.field(cellDragField)).toBe(false);
        expect(isCellDragInProgress(state)).toBe(false);

        state = state.update({ effects: setCellSelectionEffect.of(selection) }).state;

        expect(state.field(cellDragField)).toBe(false);
        expect(isCellDragInProgress(state)).toBe(false);
    });

    it('rejects shortcuts when there is no table interaction state', () => {
        const { view } = createViewHarness({ activeCell: false, selection: false });
        setActiveElement(document.body);

        expect(canHandleTableClipboardShortcut(view)).toBe(false);
    });

    it('allows shortcuts when nothing is focused but a selection exists', () => {
        const { view } = createViewHarness();
        setActiveElement(null);

        expect(canHandleTableSelectionKeydown(view)).toBe(true);
    });

    it('rejects shortcuts when nothing is focused and only an active cell exists', () => {
        const { view } = createViewHarness({ selection: false });
        setActiveElement(null);

        expect(canHandleTableClipboardShortcut(view)).toBe(false);
    });

    it.each([
        ['editor root', (harness: ReturnType<typeof createViewHarness>) => harness.root],
        ['scroll container', (harness: ReturnType<typeof createViewHarness>) => harness.scrollDOM],
        ['content container', (harness: ReturnType<typeof createViewHarness>) => harness.contentDOM],
    ])('allows shortcuts when focus is on the CodeMirror %s', (_label, pickElement) => {
        const harness = createViewHarness();
        setActiveElement(pickElement(harness));

        expect(canHandleTableSelectionKeydown(harness.view)).toBe(true);
    });

    it('rejects shortcuts when focus is on a CodeMirror container without a selection', () => {
        const { view, contentDOM } = createViewHarness({ selection: false });
        setActiveElement(contentDOM);

        expect(canHandleTableClipboardShortcut(view)).toBe(false);
    });

    it('allows shortcuts when focus is on a non-interactive element elsewhere in the editor', () => {
        const { view, contentDOM } = createViewHarness();
        const sibling = document.createElement('span');
        contentDOM.appendChild(sibling);
        setActiveElement(sibling);

        expect(canHandleTableSelectionKeydown(view)).toBe(true);
    });

    it('rejects shortcuts when focus is on a non-interactive element outside the editor', () => {
        const { view } = createViewHarness();
        const outside = document.createElement('span');
        document.body.appendChild(outside);
        setActiveElement(outside);

        expect(canHandleTableSelectionKeydown(view)).toBe(false);
    });

    it('rejects shortcuts when focus is outside the editor and only an active cell exists', () => {
        const { view } = createViewHarness({ selection: false });
        const outside = document.createElement('span');
        document.body.appendChild(outside);
        setActiveElement(outside);

        expect(canHandleTableClipboardShortcut(view)).toBe(false);
    });
});

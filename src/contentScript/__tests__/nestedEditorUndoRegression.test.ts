import { undo } from '@codemirror/commands';
import { history } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { hostEditorConfigFacet } from '../services/hostEditorConfig';
import { createMarkdownRenderer, markdownRenderServiceFacet } from '../services/markdownRenderer';
import { nestedEditorPlugin, isNestedEditorOpen } from '../nestedEditor/nestedEditorController';
import { activeCellField, getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { tableContextField } from '../tableState/tableContextField';
import { openCellRequestField } from '../tableRuntime/openCellRequest';
import { getResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { nestedEditorLifecyclePlugin } from '../tableRuntime/lifecycle/nestedEditorLifecycle';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { findCellElement } from '../tableWidget/domHelpers';
import { makeTableId } from '../tableModel/types';

class ResizeObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}

if (!Range.prototype.getBoundingClientRect) {
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        value: () => ({
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            toJSON: () => ({}),
        }),
    });
}

if (!Range.prototype.getClientRects) {
    Object.defineProperty(Range.prototype, 'getClientRects', {
        value: () => [],
    });
}

const TEST_HOST_CONFIG = {
    nestedEditor: {
        autoMatchingBraces: true,
        spellcheck: false,
    },
    tableAppearance: {
        zebraStriping: false,
    },
    toolbar: {
        showMoveButtons: true,
        showClearButtons: true,
        showAlignmentButtons: true,
        showDeleteTableButton: true,
        showSortButtons: true,
    },
};

describe('nested editor undo regression', () => {
    let animationFrameQueue: FrameRequestCallback[] = [];

    const flushAnimationFrames = (): void => {
        while (animationFrameQueue.length > 0) {
            const callback = animationFrameQueue.shift();
            callback?.(0);
        }
    };

    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', ResizeObserverMock as unknown as typeof ResizeObserver);
        animationFrameQueue = [];
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
            animationFrameQueue.push(callback);
            return animationFrameQueue.length;
        }) as typeof requestAnimationFrame);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('keeps the first body cell editor usable after undo restores deleted text in a single-table document', () => {
        const doc = ['| H1 |', '| --- |', '| abc |'].join('\n');
        const activeCell: ActiveCell = {
            tableFrom: 0,
            section: 'body',
            row: 0,
            col: 0,
        };
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({
            parent,
            state: EditorState.create({
                doc,
                selection: EditorSelection.single(doc.indexOf('abc') + 'abc'.length),
                extensions: [
                    history(),
                    markdown({ extensions: [GFM] }),
                    hostEditorConfigFacet.of(TEST_HOST_CONFIG),
                    markdownRenderServiceFacet.of(createMarkdownRenderer(async (markup, id) => ({ id, html: markup }))),
                    nestedEditorPlugin,
                    tableContextField,
                    activeCellField,
                    openCellRequestField,
                    nestedEditorLifecyclePlugin,
                    tableDecorationField,
                ],
            }),
        });

        view.dispatch({ effects: setActiveCellEffect.of(activeCell) });
        const cellElement = findCellElement(view, makeTableId(activeCell.tableFrom), activeCell);
        expect(cellElement).not.toBeNull();
        if (!cellElement) {
            throw new Error('Expected first body cell element');
        }

        const opened = view.plugin(nestedEditorPlugin)?.controller.open({
            mainView: view,
            cellElement,
            featureSettings: TEST_HOST_CONFIG.nestedEditor,
        });
        expect(opened).toBe(true);
        expect(isNestedEditorOpen(view)).toBe(true);

        const resolved = getResolvedActiveCell(view.state);
        expect(resolved).not.toBeNull();
        if (!resolved) {
            throw new Error('Expected resolved active cell');
        }

        view.dispatch({
            changes: { from: resolved.editableFrom, to: resolved.editableTo, insert: '' },
            selection: EditorSelection.single(resolved.editableFrom),
            annotations: syncAnnotation.of(true),
        });

        expect(undo(view)).toBe(true);
        flushAnimationFrames();

        expect(getActiveCell(view.state)).toEqual(activeCell);
        expect(isNestedEditorOpen(view)).toBe(true);

        view.destroy();
    });

    it('refreshes another table after an external edit without replacing the active table host', () => {
        const tableA = ['| A |', '| --- |', '| active |'].join('\n');
        const tableB = ['| B |', '| --- |', '| stale |'].join('\n');
        const doc = `${tableA}\n\n${tableB}`;
        const activeCell: ActiveCell = {
            tableFrom: 0,
            section: 'body',
            row: 0,
            col: 0,
        };
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({
            parent,
            state: EditorState.create({
                doc,
                selection: EditorSelection.single(doc.indexOf('active')),
                extensions: [
                    markdown({ extensions: [GFM] }),
                    hostEditorConfigFacet.of(TEST_HOST_CONFIG),
                    markdownRenderServiceFacet.of(createMarkdownRenderer(async (markup, id) => ({ id, html: markup }))),
                    nestedEditorPlugin,
                    tableContextField,
                    activeCellField,
                    openCellRequestField,
                    nestedEditorLifecyclePlugin,
                    tableDecorationField,
                ],
            }),
        });

        view.dispatch({ effects: setActiveCellEffect.of(activeCell) });
        const cellElement = findCellElement(view, makeTableId(0), activeCell);
        if (!cellElement) throw new Error('Expected active cell element');
        expect(
            view.plugin(nestedEditorPlugin)?.controller.open({
                mainView: view,
                cellElement,
                featureSettings: TEST_HOST_CONFIG.nestedEditor,
            })
        ).toBe(true);

        const activeWidget = cellElement.closest('[data-table-from]');
        const nestedEditorDom = cellElement.querySelector('.cm-editor');
        const resolved = getResolvedActiveCell(view.state);
        if (!resolved) throw new Error('Expected active cell to resolve');
        view.dispatch({
            changes: { from: resolved.editableFrom, to: resolved.editableTo, insert: 'typed' },
            annotations: syncAnnotation.of(true),
        });

        const tableBCellFrom = view.state.doc.toString().indexOf('stale');
        view.dispatch({ changes: { from: tableBCellFrom, to: tableBCellFrom + 'stale'.length, insert: 'fresh' } });

        expect(isNestedEditorOpen(view)).toBe(true);
        expect(cellElement.closest('[data-table-from]')).toBe(activeWidget);
        expect(cellElement.querySelector('.cm-editor')).toBe(nestedEditorDom);
        expect(cellElement.textContent).toContain('typed');
        expect(view.contentDOM.querySelectorAll('tbody')[1]?.textContent).toContain('fresh');

        view.destroy();
    });

    it('closes the active editor on a parser timeout and restores widgets after recovery', () => {
        const doc = '| H |\n| --- |\n| edited text |';
        const activeCell: ActiveCell = { tableFrom: 0, section: 'body', row: 0, col: 0 };
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({
            parent,
            doc,
            extensions: [
                markdown({ extensions: [GFM] }),
                hostEditorConfigFacet.of(TEST_HOST_CONFIG),
                markdownRenderServiceFacet.of(createMarkdownRenderer(async (markup, id) => ({ id, html: markup }))),
                nestedEditorPlugin,
                tableContextField,
                activeCellField,
                openCellRequestField,
                nestedEditorLifecyclePlugin,
                tableDecorationField,
            ],
        });
        try {
            view.dispatch({ effects: setActiveCellEffect.of(activeCell) });
            const cellElement = findCellElement(view, makeTableId(0), activeCell);
            if (!cellElement) throw new Error('Expected active cell element');
            expect(
                view.plugin(nestedEditorPlugin)?.controller.open({
                    mainView: view,
                    cellElement,
                    featureSettings: TEST_HOST_CONFIG.nestedEditor,
                })
            ).toBe(true);

            const filler = 'lorem ipsum dolor sit amet '.repeat(40);
            const appendedTableCount = 5;
            const appended = Array.from({ length: appendedTableCount }, () => `${filler}\n\n${doc}`).join('\n\n');
            const clockAdvanceMs = 2_000;
            let now = 0;
            const clock = vi.spyOn(Date, 'now').mockImplementation(() => (now += clockAdvanceMs));
            try {
                view.dispatch({ changes: { from: doc.length, insert: `\n\n${appended}` } });
            } finally {
                clock.mockRestore();
            }

            expect(view.state.field(tableContextField).treeIncomplete).toBe(true);
            expect(isNestedEditorOpen(view)).toBe(false);
            expect(view.contentDOM.querySelector('[data-table-from]')).toBeNull();
            expect(view.state.doc.sliceString(0, doc.length)).toBe(doc);
            flushAnimationFrames();

            const completeParseTimeoutMs = 1_000;
            expect(ensureSyntaxTree(view.state, view.state.doc.length, completeParseTimeoutMs)).not.toBeNull();
            view.dispatch({});
            expect(view.state.field(tableDecorationField).decorations.size).toBe(appendedTableCount + 1);
            expect(view.contentDOM.querySelector('[data-table-from]')).not.toBeNull();
            expect(isNestedEditorOpen(view)).toBe(false);
        } finally {
            view.destroy();
        }
    });

    it('closes the active editor and follows the restored cursor when undo targets another table', () => {
        const tableA = ['| A |', '| --- |', '| active |'].join('\n');
        const tableB = ['| B |', '| --- |', '| old |'].join('\n');
        const doc = `${tableA}\n\n${tableB}`;
        const tableBCellFrom = doc.indexOf('old');
        const activeCell: ActiveCell = {
            tableFrom: 0,
            section: 'body',
            row: 0,
            col: 0,
        };
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({
            parent,
            state: EditorState.create({
                doc,
                selection: EditorSelection.single(tableBCellFrom),
                extensions: [
                    history(),
                    markdown({ extensions: [GFM] }),
                    hostEditorConfigFacet.of(TEST_HOST_CONFIG),
                    markdownRenderServiceFacet.of(createMarkdownRenderer(async (markup, id) => ({ id, html: markup }))),
                    nestedEditorPlugin,
                    tableContextField,
                    activeCellField,
                    openCellRequestField,
                    nestedEditorLifecyclePlugin,
                    tableDecorationField,
                ],
            }),
        });

        view.dispatch({
            changes: { from: tableBCellFrom, to: tableBCellFrom + 3, insert: 'new' },
            selection: { anchor: tableBCellFrom + 3 },
        });
        view.dispatch({
            selection: { anchor: doc.indexOf('active') },
            effects: setActiveCellEffect.of(activeCell),
            annotations: Transaction.addToHistory.of(false),
        });
        const cellElement = findCellElement(view, makeTableId(0), activeCell);
        if (!cellElement) throw new Error('Expected active cell element');
        expect(
            view.plugin(nestedEditorPlugin)?.controller.open({
                mainView: view,
                cellElement,
                featureSettings: TEST_HOST_CONFIG.nestedEditor,
            })
        ).toBe(true);
        const resolved = getResolvedActiveCell(view.state);
        if (!resolved) throw new Error('Expected active cell to resolve');
        view.dispatch({
            changes: { from: resolved.editableFrom, to: resolved.editableTo, insert: 'typed' },
            annotations: [syncAnnotation.of(true), Transaction.addToHistory.of(false)],
        });
        const tableBFrom = view.state.field(tableContextField).tables[1].from;

        expect(undo(view)).toBe(true);
        flushAnimationFrames();

        expect(view.state.doc.toString()).toContain('| old |');
        expect(getActiveCell(view.state)?.tableFrom).toBe(tableBFrom);
        expect(isNestedEditorOpen(view)).toBe(true);
        expect(cellElement.querySelector('.cm-editor')).toBeNull();
        expect(document.activeElement?.closest(`[data-table-from="${tableBFrom}"]`)).not.toBeNull();

        view.destroy();
    });
});

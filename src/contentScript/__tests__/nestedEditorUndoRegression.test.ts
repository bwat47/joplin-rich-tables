import { history, undo } from '@codemirror/commands';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { isNestedEditorOpen, openNestedEditor } from '../nestedEditor/nestedEditorController';
import { requireResolvedActiveCell } from './testUtils';
import { getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { tableContextField } from '../tableState/tableContextField';
import { requestOpenCell } from '../tableRuntime/openCellRequest';
import { getResolvedActiveCell, resolveActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { SELECTOR_WIDGET, findCellElement } from '../tableWidget/domHelpers';
import {
    TEST_HOST_CONFIG,
    createFrameQueue,
    installRangeLayoutStubs,
    nestedEditorTestExtensions,
} from './tableEditorFixtures';

installRangeLayoutStubs();

describe('nested editor undo regression', () => {
    const frames = createFrameQueue();

    beforeEach(() => {
        frames.install();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('keeps the first body cell editor usable after undo restores deleted text in a single-table document', async () => {
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
                extensions: nestedEditorTestExtensions(history()),
            }),
        });

        view.dispatch({ effects: setActiveCellEffect.of(activeCell) });
        const cellElement = findCellElement(view, activeCell.tableFrom, activeCell);
        expect(cellElement).not.toBeNull();
        if (!cellElement) {
            throw new Error('Expected first body cell element');
        }

        const opened = openNestedEditor({
            mainView: view,
            resolvedCell: requireResolvedActiveCell(view.state),
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
        await frames.flush();

        expect(getActiveCell(view.state)).toEqual(activeCell);
        expect(isNestedEditorOpen(view)).toBe(true);

        view.destroy();
    });

    it('refreshes another table after an external edit without replacing the active table host', async () => {
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
                extensions: nestedEditorTestExtensions(),
            }),
        });

        view.dispatch({ effects: setActiveCellEffect.of(activeCell) });
        const cellElement = findCellElement(view, 0, activeCell);
        if (!cellElement) throw new Error('Expected active cell element');
        expect(
            openNestedEditor({
                mainView: view,
                resolvedCell: requireResolvedActiveCell(view.state),
                cellElement,
                featureSettings: TEST_HOST_CONFIG.nestedEditor,
            })
        ).toBe(true);

        const activeWidget = cellElement.closest(SELECTOR_WIDGET);
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
        expect(cellElement.closest(SELECTOR_WIDGET)).toBe(activeWidget);
        expect(cellElement.querySelector('.cm-editor')).toBe(nestedEditorDom);
        expect(cellElement.textContent).toContain('typed');
        expect(view.contentDOM.querySelectorAll('tbody')[1]?.textContent).toContain('fresh');

        view.destroy();
    });

    it('keeps table and unrelated media DOM when editing and opening another cell in the same table', async () => {
        const doc = '| A | B |\n| --- | --- |\n| first | second |';
        const firstCell: ActiveCell = { tableFrom: 0, section: 'body', row: 0, col: 0 };
        const secondCell: ActiveCell = { ...firstCell, col: 1 };
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({
            parent,
            doc,
            extensions: nestedEditorTestExtensions(),
        });
        try {
            const openCell = async (cell: ActiveCell): Promise<void> => {
                const resolvedCell = resolveActiveCell(view.state, cell);
                if (!resolvedCell) throw new Error('Expected cell to resolve');
                requestOpenCell(view, { resolvedCell, entryMode: 'enter' });
                await frames.flush();
            };
            await openCell(firstCell);
            const firstElement = findCellElement(view, 0, firstCell);
            const secondElement = findCellElement(view, 0, secondCell);
            const table = view.contentDOM.querySelector('table');
            if (!firstElement || !secondElement || !table) throw new Error('Expected table DOM');
            // Stand in for media mounted by the renderer in an unrelated cell.
            const media = document.createElement('video');
            table.querySelector('th')!.appendChild(media);
            const editorDom = firstElement.querySelector<HTMLElement>('.cm-editor');
            if (!editorDom) throw new Error('Expected first cell editor');
            const editor = EditorView.findFromDOM(editorDom);
            if (!editor) throw new Error('Expected nested editor view');
            editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: 'updated first' } });

            await openCell(secondCell);

            expect(view.contentDOM.querySelector('table')).toBe(table);
            expect(view.contentDOM.querySelector('video')).toBe(media);
            expect(firstElement.querySelector('.cm-editor')).toBeNull();
            expect(firstElement.textContent).toContain('updated first');
            expect(secondElement.querySelector('.cm-editor')).not.toBeNull();
            expect(secondElement.querySelector('.cm-content')?.textContent).toBe('second');
            expect(getActiveCell(view.state)).toEqual(secondCell);
            expect(isNestedEditorOpen(view)).toBe(true);

            await openCell(firstCell);
            expect(firstElement.querySelector('.cm-content')?.textContent).toBe('updated first');
            expect(view.contentDOM.querySelector('video')).toBe(media);
        } finally {
            view.destroy();
        }
    });

    it('closes the active editor on a parser timeout and restores widgets after recovery', async () => {
        const doc = '| H |\n| --- |\n| edited text |';
        const activeCell: ActiveCell = { tableFrom: 0, section: 'body', row: 0, col: 0 };
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({
            parent,
            doc,
            extensions: nestedEditorTestExtensions(),
        });
        try {
            view.dispatch({ effects: setActiveCellEffect.of(activeCell) });
            const cellElement = findCellElement(view, 0, activeCell);
            if (!cellElement) throw new Error('Expected active cell element');
            expect(
                openNestedEditor({
                    mainView: view,
                    resolvedCell: requireResolvedActiveCell(view.state),
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
            expect(view.contentDOM.querySelector(SELECTOR_WIDGET)).toBeNull();
            expect(view.state.doc.sliceString(0, doc.length)).toBe(doc);
            await frames.flush();

            const completeParseTimeoutMs = 1_000;
            expect(ensureSyntaxTree(view.state, view.state.doc.length, completeParseTimeoutMs)).not.toBeNull();
            view.dispatch({});
            expect(view.state.field(tableDecorationField).decorations.size).toBe(appendedTableCount + 1);
            expect(view.contentDOM.querySelector(SELECTOR_WIDGET)).not.toBeNull();
            expect(isNestedEditorOpen(view)).toBe(false);
        } finally {
            view.destroy();
        }
    });

    it('closes the active editor and follows the restored cursor when undo targets another table', async () => {
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
                extensions: nestedEditorTestExtensions(history()),
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
        const cellElement = findCellElement(view, 0, activeCell);
        if (!cellElement) throw new Error('Expected active cell element');
        expect(
            openNestedEditor({
                mainView: view,
                resolvedCell: requireResolvedActiveCell(view.state),
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
        await frames.flush();

        expect(view.state.doc.toString()).toContain('| old |');
        expect(getActiveCell(view.state)?.tableFrom).toBe(tableBFrom);
        expect(isNestedEditorOpen(view)).toBe(true);
        expect(cellElement.querySelector('.cm-editor')).toBeNull();
        const focusedWidget = document.activeElement?.closest(SELECTOR_WIDGET);
        expect(focusedWidget).not.toBeNull();
        if (!focusedWidget) throw new Error('Expected focus inside the restored table widget');
        expect(view.posAtDOM(focusedWidget)).toBe(tableBFrom);

        view.destroy();
    });
});

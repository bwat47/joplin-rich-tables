import { EditorSelection, EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNestedEditorInteractionExtensions } from '../tableRuntime/interaction/nestedEditorInteractionExtensions';
import { handleTableClipboardTextPaste } from '../tableRuntime/selection/cellSelectionClipboard';
import type * as CellSelectionClipboard from '../tableRuntime/selection/cellSelectionClipboard';
import { activeCellField, getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { cellSelectionField, getCellSelection } from '../tableState/cellSelectionState';
import { createEditorViewHarness, installRangeLayoutStubs, pressKey } from './tableEditorFixtures';
import { createMarkdownState } from './testMarkdownState';

installRangeLayoutStubs();

vi.mock('../tableRuntime/selection/cellSelectionClipboard', async (importOriginal) => ({
    ...(await importOriginal<typeof CellSelectionClipboard>()),
    handleTableClipboardTextPaste: vi.fn(() => false),
}));

const handleTableClipboardTextPasteMock = vi.mocked(handleTableClipboardTextPaste);

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '| b1 | b2 |'].join('\n');
const PREFIX = 'above\n\n';
const DOC = `${PREFIX}${TABLE}\n\nbelow`;
const TABLE_FROM = PREFIX.length;
const TABLE_TO = TABLE_FROM + TABLE.length;
const viewHarness = createEditorViewHarness();

function dispatchPaste(target: HTMLElement, text: string): void {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
        value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    });
    target.dispatchEvent(event);
}

function createPasteView(): EditorView {
    return viewHarness.mountView({
        state: EditorState.create({
            doc: 'selected text',
            selection: EditorSelection.single(0, 'selected'.length),
            extensions: createNestedEditorInteractionExtensions({} as EditorView, {
                closeEditor: vi.fn(),
                syncPendingChangesToRoot: vi.fn(),
            }),
        }),
    });
}

function mountMainView(activeCell: ActiveCell): EditorView {
    const view = viewHarness.mountView({
        state: createMarkdownState(DOC, [activeCellField, cellSelectionField]),
    });
    view.dispatch({ effects: setActiveCellEffect.of(activeCell) });
    return view;
}

function mountNestedView(
    mainView: EditorView,
    selection: number
): { view: EditorView; sync: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } {
    const sync = vi.fn();
    const close = vi.fn();
    const view = viewHarness.mountView({
        doc: 'cell',
        selection: { anchor: selection },
        extensions: [
            createNestedEditorInteractionExtensions(mainView, {
                closeEditor: close,
                syncPendingChangesToRoot: sync,
            }),
        ],
    });
    view.contentDOM.focus();
    return { view, sync, close };
}

/**
 * jsdom has no layout, so `coordsAtPos` returns null and the keymap falls back to its
 * exact-position check. Stubbing it exercises the wrapped-line measurement branch instead.
 */
function stubLineTops(view: EditorView, tops: Record<number, number>): void {
    vi.spyOn(view, 'coordsAtPos').mockImplementation((pos: number) => {
        const top = tops[pos];
        return top !== undefined ? { top, bottom: top + 10, left: 0, right: 5 } : null;
    });
}

afterEach(() => {
    vi.restoreAllMocks();
    viewHarness.destroyViews();
});

describe('nested editor horizontal table exit', () => {
    it('exits above the table on ArrowLeft from the first cell start', () => {
        const mainView = mountMainView({ tableFrom: TABLE_FROM, section: 'header', row: 0, col: 0 });
        const nested = mountNestedView(mainView, 0);

        pressKey(nested.view.contentDOM, { key: 'ArrowLeft' });

        expect(nested.sync).toHaveBeenCalledOnce();
        expect(getActiveCell(mainView.state)).toBeNull();
        expect(mainView.state.selection.main.head).toBe(TABLE_FROM - 1);
    });

    it('exits below the table on ArrowRight from the final cell end', () => {
        const mainView = mountMainView({ tableFrom: TABLE_FROM, section: 'body', row: 1, col: 1 });
        const nested = mountNestedView(mainView, 'cell'.length);

        pressKey(nested.view.contentDOM, { key: 'ArrowRight' });

        expect(nested.sync).toHaveBeenCalledOnce();
        expect(getActiveCell(mainView.state)).toBeNull();
        expect(mainView.state.selection.main.head).toBe(TABLE_TO + 1);
    });
});

describe('nested editor vertical table exit', () => {
    const CELL_END = 'cell'.length;

    it('exits above the table on ArrowUp from the first cell start', () => {
        const mainView = mountMainView({ tableFrom: TABLE_FROM, section: 'header', row: 0, col: 0 });
        const nested = mountNestedView(mainView, 0);

        pressKey(nested.view.contentDOM, { key: 'ArrowUp' });

        expect(nested.sync).toHaveBeenCalledOnce();
        expect(getActiveCell(mainView.state)).toBeNull();
        expect(mainView.state.selection.main.head).toBe(TABLE_FROM - 1);
    });

    it('exits below the table on ArrowDown from the final cell end', () => {
        const mainView = mountMainView({ tableFrom: TABLE_FROM, section: 'body', row: 1, col: 1 });
        const nested = mountNestedView(mainView, CELL_END);

        pressKey(nested.view.contentDOM, { key: 'ArrowDown' });

        expect(nested.sync).toHaveBeenCalledOnce();
        expect(getActiveCell(mainView.state)).toBeNull();
        expect(mainView.state.selection.main.head).toBe(TABLE_TO + 1);
    });

    it('stays inside the cell when the caret sits on a lower visual line than the start', () => {
        const mainView = mountMainView({ tableFrom: TABLE_FROM, section: 'header', row: 0, col: 0 });
        const nested = mountNestedView(mainView, 2);
        stubLineTops(nested.view, { 0: 0, 2: 20 });

        pressKey(nested.view.contentDOM, { key: 'ArrowUp' });

        expect(nested.sync).not.toHaveBeenCalled();
        expect(getActiveCell(mainView.state)).not.toBeNull();
    });

    it('exits the table when a wrapped caret shares the start visual line', () => {
        const mainView = mountMainView({ tableFrom: TABLE_FROM, section: 'header', row: 0, col: 0 });
        const nested = mountNestedView(mainView, 2);
        stubLineTops(nested.view, { 0: 0, 2: 0 });

        pressKey(nested.view.contentDOM, { key: 'ArrowUp' });

        expect(nested.sync).toHaveBeenCalledOnce();
        expect(getActiveCell(mainView.state)).toBeNull();
    });
});

describe('nested editor vertical cell selection', () => {
    const CELL_END = 'cell'.length;

    it('starts an upward cell selection on Shift-ArrowUp from the cell start', () => {
        const mainView = mountMainView({ tableFrom: TABLE_FROM, section: 'body', row: 1, col: 0 });
        const nested = mountNestedView(mainView, 0);

        pressKey(nested.view.contentDOM, { key: 'ArrowUp', shiftKey: true });

        expect(nested.close).toHaveBeenCalledOnce();
        expect(getCellSelection(mainView.state)).not.toBeNull();
    });

    it('starts a downward cell selection on Shift-ArrowDown from the cell end', () => {
        const mainView = mountMainView({ tableFrom: TABLE_FROM, section: 'header', row: 0, col: 0 });
        const nested = mountNestedView(mainView, CELL_END);

        pressKey(nested.view.contentDOM, { key: 'ArrowDown', shiftKey: true });

        expect(nested.close).toHaveBeenCalledOnce();
        expect(getCellSelection(mainView.state)).not.toBeNull();
    });

    it('leaves the nested editor open when the caret is mid-cell', () => {
        const mainView = mountMainView({ tableFrom: TABLE_FROM, section: 'body', row: 1, col: 0 });
        const nested = mountNestedView(mainView, 2);
        stubLineTops(nested.view, { 0: 0, 2: 20 });

        pressKey(nested.view.contentDOM, { key: 'ArrowUp', shiftKey: true });

        expect(nested.close).not.toHaveBeenCalled();
        expect(getCellSelection(mainView.state)).toBeNull();
    });
});

describe('nested editor table paste', () => {
    afterEach(() => {
        handleTableClipboardTextPasteMock.mockReset();
        handleTableClipboardTextPasteMock.mockReturnValue(false);
    });
    it('routes a table fragment pasted into the nested editor through the multi-cell rewrite', () => {
        const nestedView = createPasteView();
        handleTableClipboardTextPasteMock.mockReturnValue(true);

        const clipboardText = ['| P1 | P2 |', '| --- | --- |', '| Q1 | Q2 |'].join('\n');
        dispatchPaste(nestedView.contentDOM, clipboardText);

        expect(handleTableClipboardTextPasteMock).toHaveBeenCalledWith(clipboardText, expect.anything(), {
            nestedEditorOpen: true,
        });
        // The rewrite owns the paste, so nothing lands in the cell editor itself.
        expect(nestedView.state.doc.toString()).toBe('selected text');
    });

    it('lets a non-table paste fall through to the nested editor', () => {
        const nestedView = createPasteView();

        dispatchPaste(nestedView.contentDOM, 'plain');

        expect(handleTableClipboardTextPasteMock).toHaveBeenCalledTimes(1);
        expect(nestedView.state.doc.toString()).toBe('plain text');
    });
});

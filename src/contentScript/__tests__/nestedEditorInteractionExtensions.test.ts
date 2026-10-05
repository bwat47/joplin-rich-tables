import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleTableClipboardTextPaste } from '../tableRuntime/selection/cellSelectionClipboard';
import type * as CellSelectionClipboard from '../tableRuntime/selection/cellSelectionClipboard';
import { installRangeLayoutStubs } from './tableEditorFixtures';
import { createNestedEditorInteractionExtensions } from '../tableRuntime/interaction/nestedEditorInteractionExtensions';
import { activeCellField, getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { cellSelectionField, getCellSelection } from '../tableState/cellSelectionState';
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
const mountedViews: EditorView[] = [];

function dispatchPaste(target: HTMLElement, text: string): void {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
        value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    });
    target.dispatchEvent(event);
}

function createPasteView(parent: HTMLElement): EditorView {
    const view = new EditorView({
        parent,
        state: EditorState.create({
            doc: 'selected text',
            selection: EditorSelection.single(0, 'selected'.length),
            extensions: createNestedEditorInteractionExtensions({} as EditorView, {
                closeEditor: vi.fn(),
                syncPendingChangesToRoot: vi.fn(),
            }),
        }),
    });
    mountedViews.push(view);
    return view;
}

function mountMainView(activeCell: ActiveCell): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
        parent,
        state: createMarkdownState(DOC, [activeCellField, cellSelectionField]),
    });
    view.dispatch({ effects: setActiveCellEffect.of(activeCell) });
    mountedViews.push(view);
    return view;
}

function mountNestedView(
    mainView: EditorView,
    selection: number
): { view: EditorView; sync: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const sync = vi.fn();
    const close = vi.fn();
    const view = new EditorView({
        parent,
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
    mountedViews.push(view);
    return { view, sync, close };
}

/**
 * jsdom has no layout, so `coordsAtPos` returns null and the keymap falls back to its
 * exact-position check. Stubbing it exercises the wrapped-line measurement branch instead.
 */
function stubLineTops(view: EditorView, tops: Record<number, number>): void {
    vi.spyOn(view, 'coordsAtPos').mockImplementation((pos: number) => {
        const top = tops[pos];
        return pos in tops ? { top, bottom: top + 10, left: 0, right: 5 } : null;
    });
}

function pressKey(view: EditorView, key: string, init: KeyboardEventInit = {}): void {
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

afterEach(() => {
    vi.restoreAllMocks();
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
});

describe('nested editor horizontal table exit', () => {
    it('exits above the table on ArrowLeft from the first cell start', () => {
        const mainView = mountMainView({ tableFrom: TABLE_FROM, section: 'header', row: 0, col: 0 });
        const nested = mountNestedView(mainView, 0);

        pressKey(nested.view, 'ArrowLeft');

        expect(nested.sync).toHaveBeenCalledOnce();
        expect(getActiveCell(mainView.state)).toBeNull();
        expect(mainView.state.selection.main.head).toBe(TABLE_FROM - 1);
    });

    it('exits below the table on ArrowRight from the final cell end', () => {
        const mainView = mountMainView({ tableFrom: TABLE_FROM, section: 'body', row: 1, col: 1 });
        const nested = mountNestedView(mainView, 'cell'.length);

        pressKey(nested.view, 'ArrowRight');

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

        pressKey(nested.view, 'ArrowUp');

        expect(nested.sync).toHaveBeenCalledOnce();
        expect(getActiveCell(mainView.state)).toBeNull();
        expect(mainView.state.selection.main.head).toBe(TABLE_FROM - 1);
    });

    it('exits below the table on ArrowDown from the final cell end', () => {
        const mainView = mountMainView({ tableFrom: TABLE_FROM, section: 'body', row: 1, col: 1 });
        const nested = mountNestedView(mainView, CELL_END);

        pressKey(nested.view, 'ArrowDown');

        expect(nested.sync).toHaveBeenCalledOnce();
        expect(getActiveCell(mainView.state)).toBeNull();
        expect(mainView.state.selection.main.head).toBe(TABLE_TO + 1);
    });

    it('stays inside the cell when the caret sits on a lower visual line than the start', () => {
        const mainView = mountMainView({ tableFrom: TABLE_FROM, section: 'header', row: 0, col: 0 });
        const nested = mountNestedView(mainView, 2);
        stubLineTops(nested.view, { 0: 0, 2: 20 });

        pressKey(nested.view, 'ArrowUp');

        expect(nested.sync).not.toHaveBeenCalled();
        expect(getActiveCell(mainView.state)).not.toBeNull();
    });

    it('exits the table when a wrapped caret shares the start visual line', () => {
        const mainView = mountMainView({ tableFrom: TABLE_FROM, section: 'header', row: 0, col: 0 });
        const nested = mountNestedView(mainView, 2);
        stubLineTops(nested.view, { 0: 0, 2: 0 });

        pressKey(nested.view, 'ArrowUp');

        expect(nested.sync).toHaveBeenCalledOnce();
        expect(getActiveCell(mainView.state)).toBeNull();
    });
});

describe('nested editor vertical cell selection', () => {
    const CELL_END = 'cell'.length;

    it('starts an upward cell selection on Shift-ArrowUp from the cell start', () => {
        const mainView = mountMainView({ tableFrom: TABLE_FROM, section: 'body', row: 1, col: 0 });
        const nested = mountNestedView(mainView, 0);

        pressKey(nested.view, 'ArrowUp', { shiftKey: true });

        expect(nested.close).toHaveBeenCalledOnce();
        expect(getCellSelection(mainView.state)).not.toBeNull();
    });

    it('starts a downward cell selection on Shift-ArrowDown from the cell end', () => {
        const mainView = mountMainView({ tableFrom: TABLE_FROM, section: 'header', row: 0, col: 0 });
        const nested = mountNestedView(mainView, CELL_END);

        pressKey(nested.view, 'ArrowDown', { shiftKey: true });

        expect(nested.close).toHaveBeenCalledOnce();
        expect(getCellSelection(mainView.state)).not.toBeNull();
    });

    it('leaves the nested editor open when the caret is mid-cell', () => {
        const mainView = mountMainView({ tableFrom: TABLE_FROM, section: 'body', row: 1, col: 0 });
        const nested = mountNestedView(mainView, 2);
        stubLineTops(nested.view, { 0: 0, 2: 20 });

        pressKey(nested.view, 'ArrowUp', { shiftKey: true });

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
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const nestedView = createPasteView(parent);
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
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const nestedView = createPasteView(parent);

        dispatchPaste(nestedView.contentDOM, 'plain');

        expect(handleTableClipboardTextPasteMock).toHaveBeenCalledTimes(1);
        expect(nestedView.state.doc.toString()).toBe('plain text');
    });
});

import {
    findNext,
    findPrevious,
    openSearchPanel,
    search,
    searchKeymap,
    searchPanelOpen,
    SearchQuery,
    setSearchQuery,
} from '@codemirror/search';
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeCellField, getActiveCell, setActiveCellEffect } from '../tableState/activeCellState';
import { sourceModeField } from '../tableState/sourceMode';
import { getPendingOpenCellRequest, openCellRequestField } from '../tableRuntime/openCellRequest';
import { searchMatchCellEntryExtension } from '../tableRuntime/searchMatchCellEntry';
import { searchPanelTransitionExtension } from '../tableRuntime/searchPanelTransitions';
import { tableSelectionSnapFilter } from '../tableRuntime/selection/tableSelectionSnap';
import { isNestedEditorOpen, openNestedEditor } from '../nestedEditor/nestedEditorController';
import { findCellElement } from '../tableWidget/domHelpers';
import { CLASS_CELL_EDITOR } from '../shared/tableDomClasses';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { createMarkdownState } from './testMarkdownState';
import { applySearchCommand } from './searchPanelTestUtils';
import {
    TEST_HOST_CONFIG,
    createFrameQueue,
    createResizeObserverStub,
    installRangeLayoutStubs,
    nestedEditorTestExtensions,
} from './tableEditorFixtures';
import { requireResolvedActiveCell } from './testUtils';

const ABOVE = 'above';
const TABLE = ['| H1 | H2 |', '| --- | --- |', '| abc | x abc |'].join('\n');
const DOC = `${ABOVE}\n\n${TABLE}\n\nbelow abc`;
const TABLE_FROM = ABOVE.length + 2;
const FIRST_MATCH = DOC.indexOf('abc');
const SECOND_MATCH = DOC.indexOf('abc', FIRST_MATCH + 1);
const OUTSIDE_MATCH = DOC.lastIndexOf('abc');
const MATCH_LENGTH = 'abc'.length;
const FIRST_BODY_CELL = { tableFrom: TABLE_FROM, section: 'body' as const, row: 0, col: 0 };
const SECOND_BODY_CELL = { tableFrom: TABLE_FROM, section: 'body' as const, row: 0, col: 1 };

const resizeObserver = createResizeObserverStub();
installRangeLayoutStubs();

beforeAll(() => {
    resizeObserver.install();
});

afterAll(() => {
    vi.unstubAllGlobals();
});

function createState(query: string, cursor: number): EditorState {
    const state = createMarkdownState(DOC, [
        search(),
        tableDecorationField,
        sourceModeField,
        activeCellField,
        openCellRequestField,
        tableSelectionSnapFilter,
        searchMatchCellEntryExtension,
    ]);
    return state.update({
        selection: { anchor: cursor },
        effects: setSearchQuery.of(new SearchQuery({ search: query })),
    }).state;
}

function expectEntryInto(tr: Transaction, cell: typeof FIRST_BODY_CELL): void {
    expect(getActiveCell(tr.state)).toEqual(cell);
    expect(getPendingOpenCellRequest(tr.state)?.activeCell).toEqual(cell);
}

function expectNoEntry(tr: Transaction): void {
    expect(getPendingOpenCellRequest(tr.state)).toBeNull();
}

describe('searchMatchCellEntryExtension', () => {
    it('enters the cell holding a find-next match and keeps the match selected', () => {
        const tr = applySearchCommand(createState('abc', 0), findNext);

        expectEntryInto(tr, FIRST_BODY_CELL);
        expect(tr.state.selection.main).toMatchObject({ from: FIRST_MATCH, to: FIRST_MATCH + MATCH_LENGTH });
    });

    it('enters the cell holding a find-previous match', () => {
        const tr = applySearchCommand(createState('abc', OUTSIDE_MATCH), findPrevious);

        expectEntryInto(tr, SECOND_BODY_CELL);
        expect(tr.state.selection.main).toMatchObject({ from: SECOND_MATCH, to: SECOND_MATCH + MATCH_LENGTH });
    });

    it('moves the entry to another cell from an active cell', () => {
        const state = createState('abc', FIRST_MATCH + MATCH_LENGTH);
        const active = state.update({ effects: setActiveCellEffect.of(FIRST_BODY_CELL) }).state;

        expectEntryInto(applySearchCommand(active, findNext), SECOND_BODY_CELL);
    });

    it('leaves a match inside the active cell to the open editor', () => {
        const state = createState('abc', FIRST_MATCH);
        const active = state.update({ effects: setActiveCellEffect.of(FIRST_BODY_CELL) }).state;

        const tr = applySearchCommand(active, findNext);

        expectNoEntry(tr);
        expect(getActiveCell(tr.state)).toEqual(FIRST_BODY_CELL);
        expect(tr.state.selection.main).toMatchObject({ from: FIRST_MATCH, to: FIRST_MATCH + MATCH_LENGTH });
    });

    it('snaps a match that crosses a cell boundary to the whole table instead of entering', () => {
        const tr = applySearchCommand(createState('abc | x', 0), findNext);

        expectNoEntry(tr);
        expect(tr.state.selection.main).toMatchObject({ from: TABLE_FROM, to: TABLE_FROM + TABLE.length });
    });

    it('does not enter a cell for a match outside every table', () => {
        const tr = applySearchCommand(createState('abc', SECOND_MATCH + MATCH_LENGTH), findNext);

        expectNoEntry(tr);
        expect(tr.state.selection.main.from).toBe(OUTSIDE_MATCH);
    });

    it('does not enter a cell while the search panel shows raw tables', () => {
        const opened = applySearchCommand(createState('abc', 0), openSearchPanel).state;

        const tr = applySearchCommand(opened, findNext);

        expectNoEntry(tr);
        expect(tr.state.selection.main).toMatchObject({ from: FIRST_MATCH, to: FIRST_MATCH + MATCH_LENGTH });
    });
});

describe('find-match shortcuts with rendered tables', () => {
    const frames = createFrameQueue();
    const mountedViews: EditorView[] = [];

    beforeEach(() => {
        frames.install();
    });

    afterEach(() => {
        for (const view of mountedViews) {
            view.destroy();
            view.dom.remove();
        }
        mountedViews.length = 0;
    });

    function mount(cursor: number, query: string | null = 'abc'): EditorView {
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({
            parent,
            state: EditorState.create({
                doc: DOC,
                selection: EditorSelection.single(cursor),
                extensions: nestedEditorTestExtensions(
                    search(),
                    keymap.of(searchKeymap),
                    searchPanelTransitionExtension,
                    sourceModeField,
                    tableSelectionSnapFilter,
                    searchMatchCellEntryExtension
                ),
            }),
        });
        mountedViews.push(view);
        if (query !== null) {
            view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query })) });
        }
        return view;
    }

    function nestedSelectionIn(view: EditorView, cell: typeof FIRST_BODY_CELL): { anchor: number; head: number } {
        const host = findCellElement(view, cell.tableFrom, cell)?.querySelector(`.${CLASS_CELL_EDITOR}`);
        const nested = host ? EditorView.findFromDOM(host as HTMLElement) : null;
        if (!nested) {
            throw new Error('Expected a nested editor in the cell');
        }
        const { anchor, head } = nested.state.selection.main;
        return { anchor, head };
    }

    function pressF3(target: EventTarget): void {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true }));
    }

    it('opens the matched cell with the match selected when F3 runs in the main editor', async () => {
        const view = mount(0);

        pressF3(view.contentDOM);
        await frames.flush();

        expect(isNestedEditorOpen(view)).toBe(true);
        expect(getActiveCell(view.state)).toEqual(FIRST_BODY_CELL);
        expect(nestedSelectionIn(view, FIRST_BODY_CELL)).toEqual({ anchor: 0, head: MATCH_LENGTH });
    });

    function openBodyCellAtEnd(view: EditorView, cell: typeof FIRST_BODY_CELL): void {
        view.dispatch({ effects: setActiveCellEffect.of(cell) });
        const cellElement = findCellElement(view, TABLE_FROM, cell);
        if (!cellElement) {
            throw new Error('Expected the body cell element');
        }
        openNestedEditor({
            mainView: view,
            cellElement,
            resolvedCell: requireResolvedActiveCell(view.state),
            featureSettings: TEST_HOST_CONFIG.nestedEditor,
            initialCursorPos: 'end',
        });
    }

    it('opens the search panel when F3 runs in a cell editor without a query', async () => {
        const view = mount(FIRST_MATCH, null);
        openBodyCellAtEnd(view, FIRST_BODY_CELL);

        pressF3(document.activeElement ?? view.contentDOM);
        await frames.flush();

        expect(searchPanelOpen(view.state)).toBe(true);
        expect(getActiveCell(view.state)).toBeNull();
        expect(isNestedEditorOpen(view)).toBe(false);
    });

    it('returns focus to the main editor when F3 jumps from a cell to a match outside tables', async () => {
        const view = mount(SECOND_MATCH);
        openBodyCellAtEnd(view, SECOND_BODY_CELL);

        pressF3(document.activeElement ?? view.contentDOM);
        await frames.flush();

        expect(isNestedEditorOpen(view)).toBe(false);
        expect(getActiveCell(view.state)).toBeNull();
        expect(view.state.selection.main).toMatchObject({ from: OUTSIDE_MATCH, to: OUTSIDE_MATCH + MATCH_LENGTH });
        expect(view.hasFocus).toBe(true);

        pressF3(document.activeElement ?? view.contentDOM);
        await frames.flush();

        expect(getActiveCell(view.state)).toEqual(FIRST_BODY_CELL);
    });

    it('routes F3 from a cell editor to the root search and opens the next matched cell', async () => {
        const view = mount(FIRST_MATCH);
        openBodyCellAtEnd(view, FIRST_BODY_CELL);

        pressF3(document.activeElement ?? view.contentDOM);
        await frames.flush();

        expect(getActiveCell(view.state)).toEqual(SECOND_BODY_CELL);
        const secondCellMatch = 'x '.length;
        expect(nestedSelectionIn(view, SECOND_BODY_CELL)).toEqual({
            anchor: secondCellMatch,
            head: secondCellMatch + MATCH_LENGTH,
        });
    });
});

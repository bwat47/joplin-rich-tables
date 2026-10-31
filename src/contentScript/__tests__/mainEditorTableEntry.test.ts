import { defaultKeymap } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { EditorSelection, EditorState } from '@codemirror/state';
import { Direction, EditorView, keymap } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tableBoundaryDeletionExtension } from '../tableRuntime/boundaries/tableBoundaryDeletion';
import { mainEditorTableEntryExtension } from '../tableRuntime/navigation/mainEditorTableEntry';
import { cellSelectionKeyCapturePlugin } from '../tableRuntime/selection/cellSelectionKeymap';
import { activeCellField, getActiveCell } from '../tableState/activeCellState';
import { cellSelectionField, getCellSelection } from '../tableState/cellSelectionState';
import { getPendingOpenCellRequest, openCellRequestField } from '../tableState/openCellRequestState';
import { sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { createResizeObserverStub } from './tableEditorFixtures';
import { createMarkdownState } from './testMarkdownState';

const resizeObserver = createResizeObserverStub();

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '| b1 | b2 |'].join('\n');
const mountedViews: EditorView[] = [];

/** The two ways every table stops rendering as a widget. */
const RAW_MODE_CASES: ReadonlyArray<{ label: string; enterRawMode: (view: EditorView) => void }> = [
    {
        label: 'source mode',
        enterRawMode: (view) => {
            view.dispatch({ effects: toggleSourceModeEffect.of(true) });
        },
    },
    {
        label: 'search-forced raw mode',
        enterRawMode: (view) => {
            openSearchPanel(view);
        },
    },
];

/** The table's offset in the document as it stands, which entry may have normalized. */
function currentTableFrom(view: EditorView, table: string = TABLE): number {
    return view.state.doc.toString().indexOf(table);
}

/** TableWidget observes its own DOM for height changes; jsdom has no ResizeObserver. */
function mountView(doc: string, selection: number | { anchor: number; head: number }): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const view = new EditorView({
        parent,
        state: createMarkdownState(doc, [
            activeCellField,
            cellSelectionField,
            sourceModeField,
            openCellRequestField,
            // Tables must render as block replace decorations: vertical entry reads the
            // block structure to find the table a movement stepped over.
            tableDecorationField,
            EditorState.allowMultipleSelections.of(true),
            // Exercises arrow-key suppression after a deletion opens a cell.
            tableBoundaryDeletionExtension,
            mainEditorTableEntryExtension,
            cellSelectionKeyCapturePlugin,
            keymap.of(defaultKeymap),
        ]),
    });
    view.dispatch({ selection: typeof selection === 'number' ? { anchor: selection } : selection });
    view.contentDOM.focus();
    mountedViews.push(view);
    return view;
}

function pressKey(view: EditorView, key: string, modifiers: KeyboardEventInit = {}): void {
    view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
            ...modifiers,
        })
    );
}

function expectBoundaryCellOpen(view: EditorView, edge: 'start' | 'end'): void {
    const tableFrom = view.state.doc.toString().indexOf(TABLE);
    expect(getActiveCell(view.state)).toEqual(
        edge === 'start'
            ? { tableFrom, section: 'header', row: 0, col: 0 }
            : { tableFrom, section: 'body', row: 1, col: 1 }
    );
    expect(getPendingOpenCellRequest(view.state)).toMatchObject({ initialCursorPos: edge });
    expect(getCellSelection(view.state)).toBeNull();
}

beforeEach(() => {
    resizeObserver.install();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
});

function mockVerticalTarget(view: EditorView, targetPos: number): void {
    vi.spyOn(view, 'moveVertically').mockReturnValue(EditorSelection.cursor(targetPos));
}

function expectCellOpen(
    view: EditorView,
    expected: { tableFrom: number; section: 'header' | 'body'; row: number; col: number },
    initialCursorPos: 'start' | 'end'
): void {
    expect(getActiveCell(view.state)).toEqual(expected);
    expect(getPendingOpenCellRequest(view.state)).toMatchObject({ initialCursorPos });
}

describe('mainEditorTableEntry vertical movement', () => {
    it('opens the top-left header cell when ArrowDown skips across the table widget', () => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}\n\nbelow`;
        const view = mountView(doc, prefix.length);
        mockVerticalTarget(view, doc.indexOf('below'));

        pressKey(view, 'ArrowDown');

        // The fixture table has no blank line above it, so entry normalizes as it opens.
        expect(view.state.doc.toString()).toBe(`${prefix}\n\n${TABLE}\n\nbelow`);
        expect(getActiveCell(view.state)).toEqual({
            tableFrom: currentTableFrom(view),
            section: 'header',
            row: 0,
            col: 0,
        });
        expect(getPendingOpenCellRequest(view.state)).toMatchObject({
            initialCursorPos: 'start',
        });
    });

    it('opens the bottom-left body cell when ArrowUp skips across the table widget', () => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}\n\nbelow`;
        const view = mountView(doc, prefix.length + 1 + TABLE.length + 1);
        mockVerticalTarget(view, prefix.length);

        pressKey(view, 'ArrowUp');

        expect(getActiveCell(view.state)).toEqual({
            tableFrom: currentTableFrom(view),
            section: 'body',
            row: 1,
            col: 0,
        });
        expect(getPendingOpenCellRequest(view.state)).toMatchObject({
            initialCursorPos: 'lastLineStart',
        });
    });

    it('opens the header when ArrowUp enters a table with no body rows', () => {
        const headerOnlyTable = ['| H1 | H2 |', '| --- | --- |'].join('\n');
        const doc = `${headerOnlyTable}\n\nbelow`;
        const view = mountView(doc, doc.indexOf('below'));
        mockVerticalTarget(view, headerOnlyTable.length);

        pressKey(view, 'ArrowUp');

        expect(getActiveCell(view.state)).toEqual({
            tableFrom: currentTableFrom(view, headerOnlyTable),
            section: 'header',
            row: 0,
            col: 0,
        });
        expect(getPendingOpenCellRequest(view.state)).toMatchObject({
            initialCursorPos: 'lastLineStart',
        });
    });

    it.each(RAW_MODE_CASES)('leaves vertical movement in the main editor during $label', ({ enterRawMode }) => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);
        enterRawMode(view);
        mockVerticalTarget(view, prefix.length + 1);

        pressKey(view, 'ArrowDown');

        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('does not activate a table when vertical movement stays outside it', () => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);
        mockVerticalTarget(view, prefix.length - 1);

        pressKey(view, 'ArrowDown');

        expect(getActiveCell(view.state)).toBeNull();
    });

    it('requires entry from the side implied by the arrow direction', () => {
        const doc = `${TABLE}\nbelow`;
        const view = mountView(doc, TABLE.length + 1);
        mockVerticalTarget(view, TABLE.length);

        pressKey(view, 'ArrowDown');

        expect(getActiveCell(view.state)).toBeNull();
    });

    it('does not enter the table below when the movement stays inside a wrapped line', () => {
        const wrappedLine = 'a fairly long paragraph that wraps across several visual lines';
        const doc = `${wrappedLine}\n${TABLE}`;
        const view = mountView(doc, 2);
        // A wrapped-line step lands further along the same line block, still short of the table.
        mockVerticalTarget(view, 20);

        pressKey(view, 'ArrowDown');

        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('does not enter a table when the movement lands on an ordinary neighbouring line', () => {
        const doc = `above\nmiddle\n${TABLE}`;
        const view = mountView(doc, 5);
        mockVerticalTarget(view, 8);

        pressKey(view, 'ArrowDown');

        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('does not intercept a non-collapsed vertical selection', () => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, { anchor: 0, head: prefix.length });
        mockVerticalTarget(view, prefix.length + 1);

        pressKey(view, 'ArrowDown');

        expect(getActiveCell(view.state)).toBeNull();
    });

    it('leaves Shift+ArrowDown to the main editor', () => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);
        mockVerticalTarget(view, prefix.length + 1);

        pressKey(view, 'ArrowDown', { shiftKey: true });

        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });
});

describe('mainEditorTableEntry horizontal movement', () => {
    it('opens the first cell when ArrowRight crosses from the empty line above the table', () => {
        const prefix = 'above\n';
        const doc = `${prefix}\n${TABLE}`;
        const tableFrom = prefix.length + 1;
        const view = mountView(doc, prefix.length);

        pressKey(view, 'ArrowRight');

        expectCellOpen(view, { tableFrom, section: 'header', row: 0, col: 0 }, 'start');
    });

    it('opens the final cell when ArrowLeft crosses from the empty line below the table', () => {
        const doc = `${TABLE}\n\nbelow`;
        const view = mountView(doc, TABLE.length + 1);

        pressKey(view, 'ArrowLeft');

        expectCellOpen(view, { tableFrom: currentTableFrom(view), section: 'body', row: 1, col: 1 }, 'end');
    });

    it('leaves ordinary horizontal movement to the main editor', () => {
        const doc = `above\n\n${TABLE}`;
        const view = mountView(doc, 1);

        pressKey(view, 'ArrowRight');

        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
        expect(view.state.selection.main.head).toBe(2);
    });

    it('leaves Shift+ArrowRight to the main editor', () => {
        const prefix = 'above\n';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);

        pressKey(view, 'ArrowRight', { shiftKey: true });

        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('uses the line text direction to interpret horizontal movement', () => {
        const prefix = 'above\n';
        const doc = `${prefix}\n${TABLE}`;
        const tableFrom = prefix.length + 1;
        const view = mountView(doc, prefix.length);
        vi.spyOn(view, 'textDirectionAt').mockReturnValue(Direction.RTL);
        vi.spyOn(view, 'moveByChar').mockReturnValue(EditorSelection.cursor(tableFrom));

        pressKey(view, 'ArrowLeft');

        expectCellOpen(view, { tableFrom, section: 'header', row: 0, col: 0 }, 'start');
    });
});

describe('mainEditorTableEntry key repeat', () => {
    it('pins the caret when ArrowRight repeats while the entry request is in flight', () => {
        const prefix = 'above\n';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);

        pressKey(view, 'ArrowRight');
        const headAfterEntry = view.state.selection.main.head;
        pressKey(view, 'ArrowRight');
        pressKey(view, 'ArrowRight');

        expect(view.state.selection.main.head).toBe(headAfterEntry);
        expectCellOpen(view, { tableFrom: prefix.length + 1, section: 'header', row: 0, col: 0 }, 'start');
    });

    it('pins the caret when ArrowDown repeats while the entry request is in flight', () => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);
        mockVerticalTarget(view, prefix.length + 1);

        pressKey(view, 'ArrowDown');
        const headAfterEntry = view.state.selection.main.head;
        pressKey(view, 'ArrowDown');

        expect(view.state.selection.main.head).toBe(headAfterEntry);
        expectCellOpen(view, { tableFrom: currentTableFrom(view), section: 'header', row: 0, col: 0 }, 'start');
    });

    it('pins the caret when an arrow follows a deletion that entered the table', () => {
        const doc = `${TABLE}\n\nbelow`;
        const view = mountView(doc, TABLE.length + 2);

        pressKey(view, 'Backspace');
        pressKey(view, 'Backspace');
        const headAfterEntry = view.state.selection.main.head;
        pressKey(view, 'ArrowRight');
        pressKey(view, 'ArrowRight');

        expect(view.state.selection.main.head).toBe(headAfterEntry);
        expectBoundaryCellOpen(view, 'end');
    });

    it('leaves arrow keys to the main editor when no request is in flight', () => {
        const doc = `above\n\n${TABLE}`;
        const view = mountView(doc, 0);

        pressKey(view, 'ArrowRight');
        pressKey(view, 'ArrowRight');

        expect(view.state.selection.main.head).toBe(2);
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });
});

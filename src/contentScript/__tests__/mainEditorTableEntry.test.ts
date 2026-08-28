/**
 * @vitest-environment jsdom
 */

import { defaultKeymap } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { Direction, EditorView, keymap } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeCellField, getActiveCell, setActiveCellEffect } from '../tableState/activeCellState';
import { cellSelectionField, getCellSelection } from '../tableState/cellSelectionState';
import { searchForceSourceModeField, setSearchForceSourceModeEffect } from '../tableState/searchForceSourceMode';
import { sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { mainEditorTableEntryExtension } from '../tableRuntime/navigation/mainEditorTableEntry';
import { getPendingOpenCellRequest, openCellRequestField } from '../tableRuntime/openCellRequest';
import { cellSelectionKeyCapturePlugin } from '../tableRuntime/selection/cellSelectionKeymap';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { createMarkdownState } from './testMarkdownState';

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '| b1 | b2 |'].join('\n');
const mountedViews: EditorView[] = [];

/** TableWidget observes its own DOM for height changes; jsdom has no ResizeObserver. */
class ResizeObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}

function mountView(doc: string, selection: number | { anchor: number; head: number }): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const view = new EditorView({
        parent,
        state: createMarkdownState(doc, [
            activeCellField,
            cellSelectionField,
            searchForceSourceModeField,
            sourceModeField,
            openCellRequestField,
            // Tables must render as block replace decorations: vertical entry reads the
            // block structure to find the table a movement stepped over.
            tableDecorationField,
            EditorState.allowMultipleSelections.of(true),
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
    vi.stubGlobal('ResizeObserver', ResizeObserverMock as unknown as typeof ResizeObserver);
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

describe('mainEditorTableEntry deletion protection', () => {
    it('opens the final cell when Backspace reaches the table from below', () => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, TABLE.length + 1);

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(doc);
        expectBoundaryCellOpen(view, 'end');
    });

    it('leaves a deletion elsewhere in the document alone while a request is in flight', () => {
        const suffix = 'after';
        const doc = `${TABLE}\n${suffix}`;
        const view = mountView(doc, TABLE.length + 1);

        pressKey(view, 'Backspace');
        view.dispatch({
            changes: { from: doc.length - 1, to: doc.length },
            userEvent: 'delete.backward',
        });

        expect(view.state.doc.toString()).toBe(`${TABLE}\n${suffix.slice(0, -1)}`);
    });

    it('drops repeat deletions while the open-cell request is still in flight', () => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, TABLE.length + 1);

        // The nested editor mounts a frame later, so the main editor still owns these.
        pressKey(view, 'Backspace');
        pressKey(view, 'Backspace');
        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(doc);
        expectBoundaryCellOpen(view, 'end');
    });

    it('opens the first cell when Delete reaches the table from above', () => {
        const prefix = 'before';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);

        pressKey(view, 'Delete');

        expect(view.state.doc.toString()).toBe(doc);
        expectBoundaryCellOpen(view, 'start');
    });

    it('opens the final header cell when Backspace reaches a table with no body rows', () => {
        const headerOnlyTable = ['| H1 | H2 |', '| --- | --- |'].join('\n');
        const doc = `${headerOnlyTable}\nafter`;
        const view = mountView(doc, headerOnlyTable.length + 1);

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(doc);
        expect(getActiveCell(view.state)).toEqual({
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 1,
        });
        expect(getPendingOpenCellRequest(view.state)).toMatchObject({ initialCursorPos: 'end' });
        expect(getCellSelection(view.state)).toBeNull();
    });

    it.each([
        {
            label: 'shorter than the header',
            table: ['| H1 | H2 |', '| --- | --- |', '| a1 |'].join('\n'),
            expectedCol: 0,
        },
        {
            label: 'wider than the header',
            table: ['| H1 |', '| --- |', '| a1 | a2 |'].join('\n'),
            expectedCol: 1,
        },
    ])('opens the final source-backed cell when the last row is $label', ({ table, expectedCol }) => {
        const doc = `${table}\nafter`;
        const view = mountView(doc, table.length + 1);

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(doc);
        expect(getActiveCell(view.state)).toEqual({
            tableFrom: 0,
            section: 'body',
            row: 0,
            col: expectedCol,
        });
        expect(getPendingOpenCellRequest(view.state)).toMatchObject({ initialCursorPos: 'end' });
        expect(getCellSelection(view.state)).toBeNull();
    });

    it('deletes extra blank lines normally before protecting the final table boundary', () => {
        const doc = `${TABLE}\n\nafter`;
        const view = mountView(doc, TABLE.length + 2);

        pressKey(view, 'Backspace');
        expect(view.state.doc.toString()).toBe(`${TABLE}\nafter`);
        expect(getCellSelection(view.state)).toBeNull();

        pressKey(view, 'Backspace');
        expect(view.state.doc.toString()).toBe(`${TABLE}\nafter`);
        expectBoundaryCellOpen(view, 'end');
    });

    it('protects the table from a semantic deletion transaction without a physical key event', () => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, TABLE.length + 1);

        view.dispatch({
            changes: { from: TABLE.length, to: TABLE.length + 1 },
            userEvent: 'delete.backward',
        });

        expect(view.state.doc.toString()).toBe(doc);
        expectBoundaryCellOpen(view, 'end');
    });

    it('leaves DOM and IME-style input transactions to CodeMirror', () => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, TABLE.length + 1);

        view.dispatch({
            changes: { from: TABLE.length, to: TABLE.length + 1 },
            userEvent: 'input.type',
        });

        expect(view.state.doc.toString()).toBe(`${TABLE}after`);
        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('does not redirect a semantic deletion that does not touch the adjoining table', () => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, TABLE.length + 1);

        view.dispatch({
            changes: { from: 1, to: 2 },
            userEvent: 'delete.backward',
        });

        expect(view.state.doc.toString()).not.toBe(doc);
        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it.each([
        { label: 'source mode', effect: toggleSourceModeEffect.of(true) },
        { label: 'search-forced raw mode', effect: setSearchForceSourceModeEffect.of(true) },
    ])('leaves table Markdown editable in $label', ({ effect }) => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, TABLE.length + 1);
        view.dispatch({ effects: effect });

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).not.toBe(doc);
        expect(getCellSelection(view.state)).toBeNull();
        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('does not intercept deletion for a non-collapsed selection', () => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, { anchor: TABLE.length + 1, head: TABLE.length + 'after'.length + 1 });

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(`${TABLE}\n`);
        expect(getCellSelection(view.state)).toBeNull();
        expect(getActiveCell(view.state)).toBeNull();
    });

    it.each([
        {
            label: 'Ctrl+Backspace',
            key: 'Backspace',
            modifiers: { ctrlKey: true },
            doc: `${TABLE}\nafter`,
            caret: TABLE.length + 1,
            edge: 'end' as const,
        },
        {
            label: 'Ctrl+Delete',
            key: 'Delete',
            modifiers: { ctrlKey: true },
            doc: `before\n${TABLE}`,
            caret: 'before'.length,
            edge: 'start' as const,
        },
        {
            label: 'Shift+Backspace',
            key: 'Backspace',
            modifiers: { shiftKey: true },
            doc: `${TABLE}\nafter`,
            caret: TABLE.length + 1,
            edge: 'end' as const,
        },
    ])('protects the table from $label', ({ key, modifiers, doc, caret, edge }) => {
        const view = mountView(doc, caret);

        pressKey(view, key, modifiers);

        expect(view.state.doc.toString()).toBe(doc);
        expectBoundaryCellOpen(view, edge);
    });

    it('does not enter selection mode while an active cell exists', () => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, TABLE.length + 1);
        view.dispatch({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'body',
                row: 1,
                col: 0,
            }),
        });

        pressKey(view, 'Backspace');

        expect(getCellSelection(view.state)).toBeNull();
    });

    it('enters the table one of several carets reaches, collapsing the rest', () => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, TABLE.length + 1);
        view.dispatch({
            selection: EditorSelection.create([
                EditorSelection.cursor(doc.length),
                EditorSelection.cursor(TABLE.length + 1),
            ]),
        });

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(doc);
        expect(view.state.selection.ranges).toHaveLength(1);
        expectBoundaryCellOpen(view, 'end');
    });

    it('enters the first table in document order when carets reach two of them', () => {
        const doc = `${TABLE}\n\nbetween\n\n${TABLE}\nafter`;
        const secondTableFrom = doc.lastIndexOf(TABLE);
        const view = mountView(doc, TABLE.length + 1);
        view.dispatch({
            selection: EditorSelection.create([
                EditorSelection.cursor(TABLE.length + 1),
                EditorSelection.cursor(secondTableFrom + TABLE.length + 1),
            ]),
        });

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(doc);
        expect(getActiveCell(view.state)).toEqual({ tableFrom: 0, section: 'body', row: 1, col: 1 });
    });

    it('still deletes when no caret of a multi-range deletion reaches a table', () => {
        const doc = `${TABLE}\n\nalpha\nbeta`;
        const view = mountView(doc, doc.length);
        view.dispatch({
            selection: EditorSelection.create([
                EditorSelection.cursor(doc.indexOf('alpha') + 'alpha'.length),
                EditorSelection.cursor(doc.length),
            ]),
        });

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(`${TABLE}\n\nalph\nbet`);
        expect(getActiveCell(view.state)).toBeNull();
    });
});

describe('mainEditorTableEntry vertical movement', () => {
    it('opens the top-left header cell when ArrowDown skips across the table widget', () => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}\nbelow`;
        const tableFrom = prefix.length + 1;
        const view = mountView(doc, prefix.length);
        mockVerticalTarget(view, tableFrom + TABLE.length + 1);

        pressKey(view, 'ArrowDown');

        expect(getActiveCell(view.state)).toEqual({
            tableFrom,
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
        const doc = `${prefix}\n${TABLE}\nbelow`;
        const tableFrom = prefix.length + 1;
        const view = mountView(doc, tableFrom + TABLE.length + 1);
        mockVerticalTarget(view, prefix.length);

        pressKey(view, 'ArrowUp');

        expect(getActiveCell(view.state)).toEqual({
            tableFrom,
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
        const doc = `${headerOnlyTable}\nbelow`;
        const view = mountView(doc, headerOnlyTable.length + 1);
        mockVerticalTarget(view, headerOnlyTable.length);

        pressKey(view, 'ArrowUp');

        expect(getActiveCell(view.state)).toEqual({
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 0,
        });
        expect(getPendingOpenCellRequest(view.state)).toMatchObject({
            initialCursorPos: 'lastLineStart',
        });
    });

    it.each([
        { label: 'source mode', effect: toggleSourceModeEffect.of(true) },
        { label: 'search-forced raw mode', effect: setSearchForceSourceModeEffect.of(true) },
    ])('leaves vertical movement in the main editor during $label', ({ effect }) => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);
        view.dispatch({ effects: effect });
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

        expectCellOpen(view, { tableFrom: 0, section: 'body', row: 1, col: 1 }, 'end');
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
        expectCellOpen(view, { tableFrom: prefix.length + 1, section: 'header', row: 0, col: 0 }, 'start');
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

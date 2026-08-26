/**
 * @vitest-environment jsdom
 */

import { defaultKeymap } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
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
const EMPTY_TABLE = ['|  |  |', '| --- | --- |', '|  |  |', '|  |  |'].join('\n');
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

function expectWholeTableSelection(view: EditorView, focusEdge: 'start' | 'end'): void {
    const start = { section: 'header', row: 0, col: 0 } as const;
    const end = { section: 'body', row: 1, col: 1 } as const;

    expect(getCellSelection(view.state)).toEqual(
        focusEdge === 'start'
            ? { tableFrom: view.state.doc.toString().indexOf(TABLE), anchor: end, focus: start }
            : { tableFrom: view.state.doc.toString().indexOf(TABLE), anchor: start, focus: end }
    );
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

describe('mainEditorTableEntry deletion protection', () => {
    it('selects the entire table when Backspace reaches it from below', () => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, TABLE.length + 1);

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(doc);
        expectWholeTableSelection(view, 'end');
    });

    it('selects the entire table when Delete reaches it from above', () => {
        const prefix = 'before';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);

        pressKey(view, 'Delete');

        expect(view.state.doc.toString()).toBe(doc);
        expectWholeTableSelection(view, 'start');
    });

    it('deletes extra blank lines normally before protecting the final table boundary', () => {
        const doc = `${TABLE}\n\nafter`;
        const view = mountView(doc, TABLE.length + 2);

        pressKey(view, 'Backspace');
        expect(view.state.doc.toString()).toBe(`${TABLE}\nafter`);
        expect(getCellSelection(view.state)).toBeNull();

        pressKey(view, 'Backspace');
        expect(view.state.doc.toString()).toBe(`${TABLE}\nafter`);
        expectWholeTableSelection(view, 'end');
    });

    it('routes the next Backspace through the existing multi-cell removal behavior', () => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, TABLE.length + 1);

        pressKey(view, 'Backspace');
        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(`${EMPTY_TABLE}\nafter`);
        expect(getCellSelection(view.state)).not.toBeNull();
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
    });

    it('does not intercept deletion for a non-collapsed selection', () => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, { anchor: TABLE.length + 1, head: TABLE.length + 'after'.length + 1 });

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(`${TABLE}\n`);
        expect(getCellSelection(view.state)).toBeNull();
    });

    it.each([
        {
            label: 'Ctrl+Backspace',
            key: 'Backspace',
            modifiers: { ctrlKey: true },
            doc: `${TABLE}\nafter`,
            caret: TABLE.length + 1,
            focusEdge: 'end' as const,
        },
        {
            label: 'Ctrl+Delete',
            key: 'Delete',
            modifiers: { ctrlKey: true },
            doc: `before\n${TABLE}`,
            caret: 'before'.length,
            focusEdge: 'start' as const,
        },
        {
            label: 'Shift+Backspace',
            key: 'Backspace',
            modifiers: { shiftKey: true },
            doc: `${TABLE}\nafter`,
            caret: TABLE.length + 1,
            focusEdge: 'end' as const,
        },
    ])('protects the table from $label', ({ key, modifiers, doc, caret, focusEdge }) => {
        const view = mountView(doc, caret);

        pressKey(view, key, modifiers);

        expect(view.state.doc.toString()).toBe(doc);
        expectWholeTableSelection(view, focusEdge);
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

    it('does not intercept movement that stays outside a table', () => {
        const doc = `text\n\n${TABLE}`;
        const view = mountView(doc, 6);

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(`text\n${TABLE}`);
        expect(getCellSelection(view.state)).toBeNull();
    });

    it('requires a single selection range', () => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, TABLE.length + 1);
        view.dispatch({
            selection: EditorSelection.create([EditorSelection.cursor(TABLE.length + 1), EditorSelection.cursor(0)]),
        });

        pressKey(view, 'Backspace');

        expect(getCellSelection(view.state)).toBeNull();
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

/**
 * @vitest-environment jsdom
 */

import { defaultKeymap } from '@codemirror/commands';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { activeCellField, setActiveCellEffect } from '../tableState/activeCellState';
import { cellSelectionField, getCellSelection } from '../tableState/cellSelectionState';
import { searchForceSourceModeField, setSearchForceSourceModeEffect } from '../tableState/searchForceSourceMode';
import { sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { mainEditorTableEntryExtension } from '../tableRuntime/navigation/mainEditorTableEntry';
import { openCellRequestField } from '../tableRuntime/openCellRequest';
import { cellSelectionKeyCapturePlugin } from '../tableRuntime/selection/cellSelectionKeymap';
import { createMarkdownState } from './testMarkdownState';

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '| b1 | b2 |'].join('\n');
const EMPTY_TABLE = ['|  |  |', '| --- | --- |', '|  |  |', '|  |  |'].join('\n');
const mountedViews: EditorView[] = [];

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

afterEach(() => {
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
});

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
        { label: 'backward', direction: 'backward' as const, doc: `${TABLE}\nafter`, caret: TABLE.length + 1 },
        {
            label: 'forward',
            direction: 'forward' as const,
            doc: `before\n${TABLE}`,
            caret: 'before'.length,
        },
    ])('rewrites a soft-keyboard $label deletion into the same table selection', ({ direction, doc, caret }) => {
        const view = mountView(doc, caret);
        const changes =
            direction === 'backward' ? { from: TABLE.length, to: TABLE.length + 1 } : { from: caret, to: caret + 1 };

        view.dispatch({
            changes,
            annotations: Transaction.userEvent.of('input.type'),
        });

        expect(view.state.doc.toString()).toBe(doc);
        expectWholeTableSelection(view, direction === 'backward' ? 'end' : 'start');
    });

    it('rewrites an explicit delete.backward transaction', () => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, TABLE.length + 1);

        view.dispatch({
            changes: { from: TABLE.length, to: TABLE.length + 1 },
            annotations: Transaction.userEvent.of('delete.backward'),
        });

        expect(view.state.doc.toString()).toBe(doc);
        expectWholeTableSelection(view, 'end');
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

    it('does not intercept modified deletion keys', () => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, TABLE.length + 1);

        pressKey(view, 'Backspace', { altKey: true });

        expect(getCellSelection(view.state)).toBeNull();
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

    it('does not rewrite input.type changes that insert replacement text', () => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, TABLE.length + 1);

        view.dispatch({
            changes: { from: TABLE.length, to: TABLE.length + 1, insert: 'x' },
            annotations: Transaction.userEvent.of('input.type'),
        });

        expect(view.state.doc.toString()).toBe(`${TABLE}xafter`);
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

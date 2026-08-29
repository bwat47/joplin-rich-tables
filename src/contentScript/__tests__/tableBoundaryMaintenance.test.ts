import { history, redo, undo } from '@codemirror/commands';
import { EditorState, type Extension, type StateEffect, type Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { createMainEditorActiveCellGuard } from '../editorBridge/mainEditorGuard';
import { activeCellField, setActiveCellEffect } from '../tableState/activeCellState';
import { cellSelectionField } from '../tableState/cellSelectionState';
import { insertedTableActivationField } from '../tableState/insertedTableActivation';
import { searchForceSourceModeField, setSearchForceSourceModeEffect } from '../tableState/searchForceSourceMode';
import { sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { openCellRequestField } from '../tableRuntime/openCellRequest';
import { resolvedActiveCellField } from '../tableRuntime/activeCell/resolvedActiveCell';
import { tableBoundaryMaintenanceExtension } from '../tableRuntime/tableBoundaryMaintenance';
import { createMarkdownState } from './testMarkdownState';

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');

const runtimeState: Extension[] = [
    activeCellField,
    resolvedActiveCellField,
    cellSelectionField,
    insertedTableActivationField,
    searchForceSourceModeField,
    sourceModeField,
    openCellRequestField,
];

function createState(doc: string, options: { effects?: StateEffect<unknown>[] } = {}): EditorState {
    const state = createMarkdownState(doc, [
        ...runtimeState,
        history(),
        tableBoundaryMaintenanceExtension,
        // Mirrors production ordering: the guard's paste rewrites run before maintenance
        // inspects the result.
        createMainEditorActiveCellGuard(() => false),
    ]);

    return options.effects?.length ? state.update({ effects: options.effects }).state : state;
}

/** Applies `text` at `pos` the way the editor reports typed or pasted input. */
function input(state: EditorState, pos: number, text: string, userEvent = 'input.type'): Transaction {
    return state.update({
        changes: { from: pos, insert: text },
        selection: { anchor: pos + text.length },
        userEvent,
    });
}

/** Offset of the empty line between two blocks of `doc`. */
function blankLinePos(doc: string, followingText: string): number {
    return doc.indexOf(followingText) - 1;
}

describe('table boundary maintenance', () => {
    it('restores the blank line when text is typed above a table', () => {
        const doc = `intro\n\n${TABLE}\n`;
        const transaction = input(createState(doc), blankLinePos(doc, TABLE), 'x');

        expect(transaction.state.doc.toString()).toBe(`intro\nx\n\n${TABLE}\n`);
    });

    it('restores the blank line when text is typed below a table', () => {
        const doc = `\n${TABLE}\n\nafter`;
        const transaction = input(createState(doc), blankLinePos(doc, 'after'), 'x');

        expect(transaction.state.doc.toString()).toBe(`\n${TABLE}\n\nx\nafter`);
    });

    it('keeps the caret with the typed text', () => {
        const doc = `intro\n\n${TABLE}\n`;
        const pos = blankLinePos(doc, TABLE);
        const transaction = input(createState(doc), pos, 'xy');

        expect(transaction.state.selection.main.head).toBe(pos + 'xy'.length);
        expect(transaction.state.doc.lineAt(transaction.state.selection.main.head).text).toBe('xy');
    });

    it('pads both sides when the filled line separates two tables', () => {
        const doc = `\n${TABLE}\n\n${TABLE}\n`;
        const transaction = input(createState(doc), doc.lastIndexOf(TABLE) - 1, 'x');

        expect(transaction.state.doc.toString()).toBe(`\n${TABLE}\n\nx\n\n${TABLE}\n`);
    });

    it('leaves whitespace-only input alone', () => {
        const doc = `intro\n\n${TABLE}\n`;
        const transaction = input(createState(doc), blankLinePos(doc, TABLE), '  ');

        expect(transaction.state.doc.toString()).toBe(`intro\n  \n${TABLE}\n`);
    });

    it('leaves a new line break alone', () => {
        const doc = `intro\n\n${TABLE}\n`;
        const transaction = input(createState(doc), blankLinePos(doc, TABLE), '\n');

        expect(transaction.state.doc.toString()).toBe(`intro\n\n\n${TABLE}\n`);
    });

    it('leaves a blank line that is not the table separator alone', () => {
        const doc = `intro\n\n\n${TABLE}\n`;
        const transaction = input(createState(doc), doc.indexOf('\n\n') + 1, 'x');

        expect(transaction.state.doc.toString()).toBe(`intro\nx\n\n${TABLE}\n`);
    });

    it('leaves typing that reaches no table alone', () => {
        const doc = `intro\n\nafter`;
        const transaction = input(createState(doc), blankLinePos(doc, 'after'), 'x');

        expect(transaction.state.doc.toString()).toBe(`intro\nx\nafter`);
    });

    it.each([
        { label: 'source mode', effect: toggleSourceModeEffect.of(true) },
        { label: 'search-forced raw mode', effect: setSearchForceSourceModeEffect.of(true) },
        {
            label: 'an active cell',
            effect: setActiveCellEffect.of({ tableFrom: 7, section: 'header', row: 0, col: 0 }),
        },
    ])('leaves the document unchanged in $label', ({ effect }) => {
        const doc = `intro\n\n${TABLE}\n`;
        const state = createState(doc, { effects: [effect as StateEffect<unknown>] });
        const transaction = input(state, blankLinePos(doc, TABLE), 'x');

        expect(transaction.state.doc.toString()).toBe(`intro\nx\n${TABLE}\n`);
    });

    it('leaves composition input alone', () => {
        const doc = `intro\n\n${TABLE}\n`;
        const transaction = input(createState(doc), blankLinePos(doc, TABLE), 'x', 'input.type.compose');

        expect(transaction.state.doc.toString()).toBe(`intro\nx\n${TABLE}\n`);
    });

    it('takes back the typed text and the padding in one undo', () => {
        const doc = `intro\n\n${TABLE}\n`;
        const state = input(createState(doc), blankLinePos(doc, TABLE), 'x').state;

        let undone = state;
        undo({ state, dispatch: (transaction) => (undone = transaction.state) });

        expect(undone.doc.toString()).toBe(doc);

        let redone = undone;
        redo({ state: undone, dispatch: (transaction) => (redone = transaction.state) });

        expect(redone.doc.toString()).toBe(`intro\nx\n\n${TABLE}\n`);
    });

    it('spaces a table pasted onto the separator exactly once', () => {
        const doc = `intro\n\n${TABLE}\n`;
        const transaction = input(createState(doc), blankLinePos(doc, TABLE), TABLE, 'input.paste');
        const text = transaction.state.doc.toString();

        expect(text).toBe(`intro\n\n${TABLE}\n\n${TABLE}\n`);
    });
});

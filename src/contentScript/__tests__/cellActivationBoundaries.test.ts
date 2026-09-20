import { describe, expect, it } from 'vitest';
import type { StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { activateCellAtPosition } from '../tableRuntime/activeCell/cellActivation';
import { activeCellField, getActiveCell } from '../tableState/activeCellState';
import { searchForceSourceModeField, setSearchForceSourceModeEffect } from '../tableState/searchForceSourceMode';
import { sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { createMarkdownState } from './testMarkdownState';

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');

function withView<T>(doc: string, run: (view: EditorView) => T): T {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
        parent,
        state: createMarkdownState(doc, [activeCellField, sourceModeField, searchForceSourceModeField]),
    });

    try {
        return run(view);
    } finally {
        view.destroy();
        parent.remove();
    }
}

describe('activateCellAtPosition table boundaries', () => {
    it('activates a cell for a position inside the table', () => {
        expect(withView(TABLE, (view) => activateCellAtPosition(view, TABLE.indexOf('a1')))).toBe(true);
    });

    it('activates a cell for a position at the very end of the table', () => {
        expect(withView(TABLE, (view) => activateCellAtPosition(view, TABLE.length))).toBe(true);
    });

    it('activates the one-cell row Lezer creates for pipe-free trailing text', () => {
        const doc = `${TABLE}\ntrailing text`;

        expect(withView(doc, (view) => activateCellAtPosition(view, doc.indexOf('trailing')))).toBe(true);
    });

    it('does not activate a cell for a position in a separate paragraph', () => {
        const doc = `${TABLE}\n\nparagraph`;

        expect(withView(doc, (view) => activateCellAtPosition(view, doc.indexOf('paragraph')))).toBe(false);
    });
});

describe('cell activation in raw mode', () => {
    const RAW_MODES: ReadonlyArray<[string, StateEffect<boolean>]> = [
        ['source mode', toggleSourceModeEffect.of(true)],
        ['search-forced raw mode', setSearchForceSourceModeEffect.of(true)],
    ];

    /** Enters raw mode, runs an activation, and reports whether it left any trace. */
    function activateInRawMode(rawModeEffect: StateEffect<boolean>, activate: (view: EditorView) => boolean) {
        return withView(TABLE, (view) => {
            view.dispatch({ effects: rawModeEffect });
            const before = view.state;
            return {
                activated: activate(view),
                docUnchanged: view.state.doc.eq(before.doc),
                selectionUnchanged: view.state.selection.eq(before.selection),
                activeCell: getActiveCell(view.state),
            };
        });
    }

    const UNTOUCHED = { activated: false, docUnchanged: true, selectionUnchanged: true, activeCell: null };

    it.each(RAW_MODES)('does not activate the cell at a position in %s', (_name, rawModeEffect) => {
        expect(
            activateInRawMode(rawModeEffect, (view) =>
                activateCellAtPosition(view, TABLE.indexOf('a2'), { clearIfOutside: true, entryMode: 'enter' })
            )
        ).toEqual(UNTOUCHED);
    });
});

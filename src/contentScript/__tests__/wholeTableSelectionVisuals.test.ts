import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import {
    findRenderedTablesTouching,
    findRenderedTablesWithin,
    tableDecorationField,
} from '../tableWidget/tableDecorationField';
import { findSelectedTableSpans } from '../tableWidget/wholeTableSelectionVisuals';
import { createMarkdownState } from './testMarkdownState';

const FIRST_TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
const SECOND_TABLE = ['| H3 | H4 |', '| --- | --- |', '| b1 | b2 |'].join('\n');
const ABOVE = 'above';
const BETWEEN = 'between';
const DOC = `${ABOVE}\n\n${FIRST_TABLE}\n\n${BETWEEN}\n\n${SECOND_TABLE}\n\nbelow`;

const FIRST_FROM = ABOVE.length + 2;
const FIRST_TO = FIRST_FROM + FIRST_TABLE.length;
const SECOND_FROM = FIRST_TO + BETWEEN.length + 4;
const SECOND_TO = SECOND_FROM + SECOND_TABLE.length;

function createState(selection?: EditorSelection) {
    const state = createMarkdownState(DOC, [
        tableDecorationField,
        sourceModeField,
        EditorState.allowMultipleSelections.of(true),
    ]);
    return selection ? state.update({ selection }).state : state;
}

describe('rendered table lookups', () => {
    it('reports the document ranges of the rendered tables', () => {
        expect(findRenderedTablesWithin(createState(), 0, DOC.length)).toEqual([
            { from: FIRST_FROM, to: FIRST_TO },
            { from: SECOND_FROM, to: SECOND_TO },
        ]);
    });

    it('excludes a table the range only partly covers', () => {
        expect(findRenderedTablesWithin(createState(), 0, FIRST_TO - 1)).toEqual([]);
    });

    it('reports a table a range only reaches into', () => {
        expect(findRenderedTablesTouching(createState(), 0, FIRST_FROM + 3)).toEqual([
            { from: FIRST_FROM, to: FIRST_TO },
        ]);
    });

    it('counts a range stopping on either table edge as touching it', () => {
        expect(findRenderedTablesTouching(createState(), 0, FIRST_FROM)).toEqual([{ from: FIRST_FROM, to: FIRST_TO }]);
        expect(findRenderedTablesTouching(createState(), FIRST_TO, DOC.length)).toEqual([
            { from: FIRST_FROM, to: FIRST_TO },
            { from: SECOND_FROM, to: SECOND_TO },
        ]);
    });

    it('reports no table for a range that stops short of one', () => {
        expect(findRenderedTablesTouching(createState(), 0, FIRST_FROM - 1)).toEqual([]);
    });

    it('finds nothing in raw mode, where no table is rendered as a widget', () => {
        const rawMode = createState().update({ effects: toggleSourceModeEffect.of(true) }).state;

        expect(findRenderedTablesWithin(rawMode, 0, DOC.length)).toEqual([]);
        expect(findRenderedTablesTouching(rawMode, 0, DOC.length)).toEqual([]);
    });
});

describe('findSelectedTableSpans', () => {
    it('reports a table the selection covers end to end', () => {
        const state = createState(EditorSelection.single(0, FIRST_TO));

        expect(findSelectedTableSpans(state)).toEqual([{ from: FIRST_FROM, to: FIRST_TO }]);
    });

    it('reports every covered table when the selection spans several', () => {
        const state = createState(EditorSelection.single(0, DOC.length));

        expect(findSelectedTableSpans(state)).toEqual([
            { from: FIRST_FROM, to: FIRST_TO },
            { from: SECOND_FROM, to: SECOND_TO },
        ]);
    });

    it('reports nothing for a selection that stops short of a table end', () => {
        const state = createState(EditorSelection.single(0, FIRST_TO - 1));

        expect(findSelectedTableSpans(state)).toEqual([]);
    });

    it('reports nothing for a caret', () => {
        const state = createState(EditorSelection.single(FIRST_FROM));

        expect(findSelectedTableSpans(state)).toEqual([]);
    });

    it('collects tables covered by separate ranges of a multi-range selection', () => {
        const state = createState(
            EditorSelection.create([
                EditorSelection.range(FIRST_FROM, FIRST_TO),
                EditorSelection.range(SECOND_FROM, SECOND_TO),
            ])
        );

        expect(findSelectedTableSpans(state)).toEqual([
            { from: FIRST_FROM, to: FIRST_TO },
            { from: SECOND_FROM, to: SECOND_TO },
        ]);
    });
});

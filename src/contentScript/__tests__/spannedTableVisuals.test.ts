import type { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { makeTableId } from '../tableModel/types';
import { collectSpannedTableIds } from '../tableWidget/spannedTableVisuals';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { createMarkdownState } from './testMarkdownState';

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
const DOC = `above\n${TABLE}\nbelow`;

function createState(): EditorState {
    return createMarkdownState(DOC, [tableDecorationField]);
}

function tableRange(state: EditorState): { from: number; to: number } {
    let range: { from: number; to: number } | null = null;
    state.field(tableDecorationField).decorations.between(0, state.doc.length, (from, to) => {
        range = { from, to };
    });

    if (!range) {
        throw new Error('Expected the document to contain a table decoration');
    }

    return range;
}

function spannedIdsFor(state: EditorState, anchor: number, head: number): Set<string> {
    return collectSpannedTableIds(state.update({ selection: { anchor, head } }).state);
}

describe('collectSpannedTableIds', () => {
    it('reports a table whose range is strictly enclosed by the selection', () => {
        const state = createState();
        const table = tableRange(state);

        expect(spannedIdsFor(state, 0, state.doc.length)).toEqual(new Set([makeTableId(table.from)]));
    });

    it('ignores a selection that matches the table range exactly', () => {
        const state = createState();
        const table = tableRange(state);

        expect(spannedIdsFor(state, table.from, table.to)).toEqual(new Set());
    });

    it('ignores a fully covered table when either selection endpoint matches its boundary', () => {
        const state = createState();
        const table = tableRange(state);

        expect(spannedIdsFor(state, table.from, state.doc.length)).toEqual(new Set());
        expect(spannedIdsFor(state, 0, table.to)).toEqual(new Set());
    });

    it('ignores a selection that only reaches part-way into the table', () => {
        const state = createState();
        const table = tableRange(state);

        expect(spannedIdsFor(state, 0, table.to - 1)).toEqual(new Set());
        expect(spannedIdsFor(state, table.from + 1, state.doc.length)).toEqual(new Set());
    });

    it('ignores a cursor parked inside the table', () => {
        const state = createState();
        const table = tableRange(state);

        expect(spannedIdsFor(state, table.from, table.from)).toEqual(new Set());
    });

    it('returns nothing when the decoration field is absent', () => {
        expect(collectSpannedTableIds(createMarkdownState(DOC))).toEqual(new Set());
    });
});

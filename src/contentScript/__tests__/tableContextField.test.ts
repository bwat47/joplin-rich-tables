import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
    containsPos,
    getTableContextAtPos,
    getTableContextEndingAt,
    getTableContextStartingAt,
    getTableContexts,
    getTableContextsTouching,
    getTableContextsWithin,
    tableContextField,
} from '../tableState/tableContextField';
import { createMarkdownState } from './testMarkdownState';

const TABLE = ['| a | b |', '| --- | --- |', '| c | d |'].join('\n');
const SECOND_TABLE = ['| e | f |', '| --- | --- |', '| g | h |'].join('\n');
const TWO_TABLES = `${TABLE}\n\n${SECOND_TABLE}`;
const SECOND_TABLE_FROM = TABLE.length + 2;

function spans(state: EditorState): { from: number; to: number }[] {
    return getTableContexts(state).map(({ from, to }) => ({ from, to }));
}

function expectSameIndexAsFresh(state: EditorState): void {
    const fresh = createMarkdownState(state.doc.toString());
    expect(spans(state)).toEqual(spans(fresh));
    expect(getTableContexts(state).map((context) => context.text)).toEqual(
        getTableContexts(fresh).map((context) => context.text)
    );
}

describe('tableContextField selectors', () => {
    it('indexes root tables in document order', () => {
        const state = createMarkdownState(TWO_TABLES);

        expect(spans(state)).toEqual([
            { from: 0, to: TABLE.length },
            { from: SECOND_TABLE_FROM, to: TWO_TABLES.length },
        ]);
    });

    it('uses inclusive containment at both table boundaries', () => {
        const state = createMarkdownState(TWO_TABLES);
        const first = getTableContexts(state)[0]!;
        const span = { from: first.from, to: first.to };

        expect(containsPos(first, 0)).toBe(true);
        expect(containsPos(span, TABLE.length)).toBe(true);
        expect(containsPos(span, TABLE.length + 1)).toBe(false);

        expect(getTableContextAtPos(state, 0)?.from).toBe(0);
        expect(getTableContextAtPos(state, TABLE.length)?.from).toBe(0);
        expect(getTableContextAtPos(state, SECOND_TABLE_FROM)?.from).toBe(SECOND_TABLE_FROM);
        expect(getTableContextAtPos(state, TABLE.length + 1)).toBeNull();
    });

    it('finds no table at positions outside the document', () => {
        const state = createMarkdownState(TABLE);

        expect(getTableContextAtPos(state, -1)).toBeNull();
        expect(getTableContextAtPos(state, state.doc.length + 1)).toBeNull();
    });

    it("includes a pipe-free trailing row in Lezer's exact table range", () => {
        const doc = `${TABLE}\ntrailing text`;
        const state = createMarkdownState(doc);
        const context = getTableContextAtPos(state, TABLE.length);

        expect(context?.to).toBe(doc.length);
        expect(context?.cellRanges.rows).toHaveLength(2);
    });

    it('resolves a table start only at the exact start position', () => {
        const state = createMarkdownState(TWO_TABLES);

        expect(getTableContextStartingAt(state, 0)?.to).toBe(TABLE.length);
        expect(getTableContextStartingAt(state, SECOND_TABLE_FROM)?.from).toBe(SECOND_TABLE_FROM);
        expect(getTableContextStartingAt(state, SECOND_TABLE_FROM + 1)).toBeNull();
        expect(getTableContextStartingAt(state, TABLE.length)).toBeNull();
        expect(getTableContextStartingAt(state, -1)).toBeNull();
    });

    it('resolves a table end only at the exact end position', () => {
        const state = createMarkdownState(TWO_TABLES);

        expect(getTableContextEndingAt(state, TABLE.length)?.from).toBe(0);
        expect(getTableContextEndingAt(state, TWO_TABLES.length)?.from).toBe(SECOND_TABLE_FROM);
        expect(getTableContextEndingAt(state, TABLE.length - 1)).toBeNull();
        expect(getTableContextEndingAt(state, SECOND_TABLE_FROM)).toBeNull();
    });

    it('returns touching and contained tables with inclusive edge semantics', () => {
        const state = createMarkdownState(TWO_TABLES);

        expect(getTableContextsTouching(state, 0, TABLE.length)).toHaveLength(1);
        expect(getTableContextsTouching(state, TABLE.length, state.doc.length)).toHaveLength(2);
        expect(getTableContextsWithin(state, 0, TABLE.length - 1)).toEqual([]);
        expect(getTableContextsWithin(state, 0, TABLE.length)).toHaveLength(1);
    });

    it.each([
        ['blockquote', ['> | a | b |', '> | --- | --- |', '> | c | d |'].join('\n')],
        ['list item', ['- | a | b |', '  | --- | --- |', '  | c | d |'].join('\n')],
    ])('ignores a table nested in a %s', (_label, doc) => {
        expect(getTableContexts(createMarkdownState(doc))).toEqual([]);
    });

    it('fails fast when the field is missing', () => {
        const state = EditorState.create({ doc: TABLE });

        expect(() => getTableContexts(state)).toThrow('Field is not present');
    });
});

describe('tableContextField updates', () => {
    it('preserves field identity for non-document transactions', () => {
        const state = createMarkdownState(TABLE);

        expect(state.update({ selection: { anchor: 1 } }).state.field(tableContextField)).toBe(
            state.field(tableContextField)
        );
    });

    it('reuses derivations for duplicate text on creation', () => {
        const contexts = getTableContexts(createMarkdownState(`${TABLE}\n\n${TABLE}`));

        expect(contexts[1].table).toBe(contexts[0].table);
        expect(contexts[1].cellRanges).toBe(contexts[0].cellRanges);
    });

    it('reuses derivations while mapping shifted table spans', () => {
        const state = createMarkdownState(TABLE);
        const before = getTableContexts(state)[0];
        const updated = state.update({ changes: { from: 0, insert: 'before\n\n' } }).state;
        const after = getTableContexts(updated)[0];

        expect(after.from).toBe('before\n\n'.length);
        expect(after.table).toBe(before.table);
        expect(after.cellRanges).toBe(before.cellRanges);
    });

    it.each([
        ['insert', { from: TABLE.indexOf('c'), insert: 'new ' }],
        ['delete', { from: TABLE.indexOf('c'), to: TABLE.indexOf('c') + 1 }],
        ['split', { from: TABLE.indexOf('c'), insert: '\n' }],
        ['remove', { from: 0, to: TABLE.length }],
        ['append row', { from: TABLE.length, insert: '\n| x | y |' }],
        ['replace', { from: 0, to: TABLE.length, insert: SECOND_TABLE }],
    ])('matches a fresh index after %s', (_label, changes) => {
        const updated = createMarkdownState(TABLE).update({ changes }).state;
        expectSameIndexAsFresh(updated);
    });

    it('matches a fresh index after merging adjacent table source', () => {
        const state = createMarkdownState(TWO_TABLES);
        const merged = state.update({ changes: { from: TABLE.length, to: SECOND_TABLE_FROM } }).state;

        expectSameIndexAsFresh(merged);
    });

    it('matches a fresh index after mixed edits to multiple tables and their surrounding paragraph', () => {
        const doc = `before\n\n${TWO_TABLES}\n\nafter`;
        const firstCell = doc.indexOf('c');
        const secondCell = doc.indexOf('g');
        const after = doc.lastIndexOf('after');
        const updated = createMarkdownState(doc).update({
            changes: [
                { from: firstCell, to: firstCell + 1, insert: 'first' },
                { from: secondCell, to: secondCell + 1, insert: 'second' },
                { from: after, to: after + 'after'.length, insert: 'tail' },
            ],
        }).state;

        expectSameIndexAsFresh(updated);
    });

    it('rescans root membership when a table becomes a blockquote', () => {
        const lineStarts = [
            0,
            ...TABLE.split('\n')
                .slice(0, -1)
                .map((_line, index) => {
                    return (
                        TABLE.split('\n')
                            .slice(0, index + 1)
                            .join('\n').length + 1
                    );
                }),
        ];
        const nested = createMarkdownState(TABLE).update({
            changes: lineStarts.map((from) => ({ from, insert: '> ' })),
        }).state;

        expect(getTableContexts(nested)).toEqual([]);
        expectSameIndexAsFresh(nested);
    });

    it('rescans later table membership when a fence is inserted at the first boundary', () => {
        const state = createMarkdownState(TWO_TABLES);
        const fenced = state.update({ changes: { from: 0, insert: '~~~\n' } }).state;

        expect(getTableContexts(fenced)).toEqual([]);
        const restored = fenced.update({ changes: { from: 0, to: 4 } }).state;
        expect(spans(restored)).toEqual(spans(createMarkdownState(TWO_TABLES)));
    });

    it('keeps an already parsed document complete during ordinary typing', () => {
        const doc = Array.from({ length: 200 }, (_value, index) => `paragraph ${index}\n\n${TABLE}`).join('\n\n');
        const state = createMarkdownState(doc);
        const updated = state.update({ changes: { from: doc.indexOf('c'), insert: 'x' } }).state;

        expect(updated.field(tableContextField).treeIncomplete).toBe(false);
        expectSameIndexAsFresh(updated);
    });
});

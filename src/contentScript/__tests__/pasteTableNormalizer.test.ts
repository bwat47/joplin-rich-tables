import { describe, expect, it } from '@jest/globals';
import { createMarkdownState } from './testMarkdownState';
import { buildRootTablePasteRewrite, parseSinglePastedTable } from '../tableRuntime/operations/pasteTableNormalizer';

const NON_CANONICAL_TABLE = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');
const CANONICAL_TABLE = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');

describe('pasteTableNormalizer', () => {
    describe('parseSinglePastedTable', () => {
        it('accepts a valid table', () => {
            expect(parseSinglePastedTable(CANONICAL_TABLE)?.serialize()).toBe(CANONICAL_TABLE);
        });

        it('accepts a valid table with outer blank lines', () => {
            expect(parseSinglePastedTable(`\n\n${NON_CANONICAL_TABLE}\n\n`)?.serialize()).toBe(CANONICAL_TABLE);
        });

        it('rejects table plus trailing text', () => {
            expect(parseSinglePastedTable(`${CANONICAL_TABLE}\ntrailing text`)).toBeNull();
        });

        it('rejects leading text plus table', () => {
            expect(parseSinglePastedTable(`leading text\n${CANONICAL_TABLE}`)).toBeNull();
        });

        it('rejects non-table text', () => {
            expect(parseSinglePastedTable('plain text')).toBeNull();
        });

        it('rejects empty text', () => {
            expect(parseSinglePastedTable('\n \n')).toBeNull();
        });
    });

    describe('buildRootTablePasteRewrite', () => {
        it('allows insert at empty document start', () => {
            const state = createMarkdownState('');
            const rewrite = buildRootTablePasteRewrite(state, 0, 0, NON_CANONICAL_TABLE);

            expect(rewrite).toEqual({
                changes: {
                    from: 0,
                    to: 0,
                    insert: `\n${CANONICAL_TABLE}\n`,
                },
                selectionAnchor: 1,
                tableFrom: 1,
            });
        });

        it('allows insert on a whitespace-only line between paragraphs', () => {
            const doc = ['before', '   ', 'after'].join('\n');
            const state = createMarkdownState(doc);
            const insertionPos = doc.indexOf('   ');
            const rewrite = buildRootTablePasteRewrite(state, insertionPos, insertionPos, NON_CANONICAL_TABLE);

            expect(rewrite).not.toBeNull();
            const nextDoc = state.update({ changes: rewrite!.changes }).state.doc.toString();

            expect(nextDoc).toBe(['before', '', ...CANONICAL_TABLE.split('\n'), '', 'after'].join('\n'));
            expect(rewrite?.tableFrom).toBe('before\n\n'.length);
        });

        it('adds blank-line separation before and after adjacent non-empty blocks', () => {
            const doc = ['before', '', 'after'].join('\n');
            const state = createMarkdownState(doc);
            const insertionPos = 'before\n'.length;
            const rewrite = buildRootTablePasteRewrite(state, insertionPos, insertionPos, NON_CANONICAL_TABLE);

            expect(rewrite).not.toBeNull();
            const nextDoc = state.update({ changes: rewrite!.changes }).state.doc.toString();

            expect(nextDoc).toBe(['before', '', ...CANONICAL_TABLE.split('\n'), '', 'after'].join('\n'));
        });

        it('adds a trailing newline when inserting at document end', () => {
            const doc = ['before', '   '].join('\n');
            const state = createMarkdownState(doc);
            const insertionPos = doc.indexOf('   ');
            const rewrite = buildRootTablePasteRewrite(state, insertionPos, insertionPos, NON_CANONICAL_TABLE);

            expect(rewrite).not.toBeNull();
            const nextDoc = state.update({ changes: rewrite!.changes }).state.doc.toString();

            expect(nextDoc).toBe(['before', '', ...CANONICAL_TABLE.split('\n'), ''].join('\n'));
        });

        it('rejects paste when caret is mid-line inside text', () => {
            const doc = 'before after';
            const state = createMarkdownState(doc);

            expect(
                buildRootTablePasteRewrite(state, doc.indexOf(' '), doc.indexOf(' '), NON_CANONICAL_TABLE)
            ).toBeNull();
        });

        it('rejects paste when the touched boundary line keeps non-whitespace content', () => {
            const doc = ['before', 'abc   ', 'after'].join('\n');
            const state = createMarkdownState(doc);
            const from = doc.indexOf('   ');
            const to = from + 3;

            expect(buildRootTablePasteRewrite(state, from, to, NON_CANONICAL_TABLE)).toBeNull();
        });

        it('returns an absolute table start in the post-change document', () => {
            const doc = ['before', '   ', 'after'].join('\n');
            const state = createMarkdownState(doc);
            const insertionPos = doc.indexOf('   ');
            const rewrite = buildRootTablePasteRewrite(state, insertionPos, insertionPos, NON_CANONICAL_TABLE);

            expect(rewrite?.tableFrom).toBe(8);
        });
    });
});

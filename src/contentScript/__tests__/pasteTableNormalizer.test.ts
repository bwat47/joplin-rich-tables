import { describe, expect, it } from 'vitest';
import { createMarkdownState } from './testMarkdownState';
import { buildRootTablePasteRewrite } from '../tableRuntime/operations/pasteTableNormalizer';

const NON_CANONICAL_TABLE = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');
const CANONICAL_TABLE = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');

describe('pasteTableNormalizer', () => {
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

        it('adds canonical spacing when pasting a table mid-line inside text', () => {
            const doc = 'before after';
            const state = createMarkdownState(doc);
            const insertionPos = doc.indexOf(' ');
            const rewrite = buildRootTablePasteRewrite(state, insertionPos, insertionPos, NON_CANONICAL_TABLE);

            expect(rewrite).toEqual({
                changes: {
                    from: insertionPos,
                    to: insertionPos,
                    insert: `\n\n${CANONICAL_TABLE}\n\n`,
                },
                selectionAnchor: insertionPos + 2,
                tableFrom: insertionPos + 2,
            });
        });

        it('adds canonical spacing when replacing whitespace after line content', () => {
            const doc = ['before', 'abc   ', 'after'].join('\n');
            const state = createMarkdownState(doc);
            const from = doc.indexOf('   ');
            const to = from + 3;
            const rewrite = buildRootTablePasteRewrite(state, from, to, NON_CANONICAL_TABLE);

            expect(rewrite).not.toBeNull();
            const nextDoc = state.update({ changes: rewrite!.changes }).state.doc.toString();

            expect(nextDoc).toBe(['before', 'abc', '', ...CANONICAL_TABLE.split('\n'), '', 'after'].join('\n'));
            expect(rewrite?.tableFrom).toBe(from + 2);
        });

        it('declines a clipboard holding more than one table', () => {
            const state = createMarkdownState('');
            const twoTables = [CANONICAL_TABLE, '', ['| H3 |', '| --- |', '| c |'].join('\n')].join('\n');

            expect(buildRootTablePasteRewrite(state, 0, 0, twoTables)).toBeNull();
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

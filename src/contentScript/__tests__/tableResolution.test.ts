import { describe, expect, it } from 'vitest';
import { resolveContainingTableAtPos } from '../tableRuntime/tableResolution';
import { createMarkdownState } from './testMarkdownState';

const TABLE = ['| a | b |', '| --- | --- |', '| c | d |'].join('\n');
const SECOND_TABLE = ['| e | f |', '| --- | --- |', '| g | h |'].join('\n');
const TWO_TABLES = `${TABLE}\n\n${SECOND_TABLE}`;
const SECOND_TABLE_FROM = TABLE.length + '\n\n'.length;

describe('resolveContainingTableAtPos', () => {
    it('resolves a position inside a table', () => {
        const state = createMarkdownState(TABLE);

        expect(resolveContainingTableAtPos(state, TABLE.indexOf('c'))).toEqual({
            from: 0,
            to: TABLE.length,
            text: TABLE,
        });
    });

    it('includes a position exactly at the end of a table node', () => {
        const state = createMarkdownState(TABLE);

        expect(resolveContainingTableAtPos(state, TABLE.length)).toEqual({
            from: 0,
            to: TABLE.length,
            text: TABLE,
        });
    });

    it('includes the trimmed table end before trailing non-table text', () => {
        const state = createMarkdownState(`${TABLE}\ntrailing text`);

        expect(resolveContainingTableAtPos(state, TABLE.length)?.to).toBe(TABLE.length);
    });

    it("rejects trailing text included in Lezer's table node", () => {
        const state = createMarkdownState(`${TABLE}\ntrailing text`);
        const trailingTextPos = TABLE.length + 1;

        expect(resolveContainingTableAtPos(state, trailingTextPos)).toBeNull();
    });

    it('returns null outside a table', () => {
        const prefix = 'before\n\n';
        const state = createMarkdownState(`${prefix}${TABLE}`);

        expect(resolveContainingTableAtPos(state, 0)).toBeNull();
    });

    describe('with a second table following', () => {
        it('resolves the preceding table at its end rather than the table below', () => {
            const state = createMarkdownState(TWO_TABLES);

            expect(resolveContainingTableAtPos(state, TABLE.length)).toEqual({
                from: 0,
                to: TABLE.length,
                text: TABLE,
            });
        });

        it('resolves the second table at its start', () => {
            const state = createMarkdownState(TWO_TABLES);

            expect(resolveContainingTableAtPos(state, SECOND_TABLE_FROM)).toEqual({
                from: SECOND_TABLE_FROM,
                to: SECOND_TABLE_FROM + SECOND_TABLE.length,
                text: SECOND_TABLE,
            });
        });

        it('resolves the second table for a position inside it', () => {
            const state = createMarkdownState(TWO_TABLES);

            expect(resolveContainingTableAtPos(state, TWO_TABLES.indexOf('g'))?.from).toBe(SECOND_TABLE_FROM);
        });

        it('returns null on the blank line separating the two tables', () => {
            const state = createMarkdownState(TWO_TABLES);

            expect(resolveContainingTableAtPos(state, TABLE.length + 1)).toBeNull();
        });
    });
});

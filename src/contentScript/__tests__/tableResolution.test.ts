import { describe, expect, it } from 'vitest';
import { resolveContainingTableAtPos } from '../tableRuntime/tableResolution';
import { createMarkdownState } from './testMarkdownState';

const TABLE = ['| a | b |', '| --- | --- |', '| c | d |'].join('\n');

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
});

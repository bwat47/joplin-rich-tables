import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
    findTableRanges,
    resolveContainingTableAtPos,
    resolveTableContext,
    resolveTableContextAtPos,
} from '../tableRuntime/tableResolution';
import { createMarkdownState } from './testMarkdownState';

const TABLE = ['| a | b |', '| --- | --- |', '| c | d |'].join('\n');
const SECOND_TABLE = ['| e | f |', '| --- | --- |', '| g | h |'].join('\n');
const TWO_TABLES = `${TABLE}\n\n${SECOND_TABLE}`;
const SECOND_TABLE_FROM = TABLE.length + '\n\n'.length;

describe('resolveContainingTableAtPos', () => {
    it('resolves a position inside a table', () => {
        const state = createMarkdownState(TABLE);

        expect(resolveContainingTableAtPos(state, TABLE.indexOf('c'))).toMatchObject({
            from: 0,
            to: TABLE.length,
        });
    });

    it('includes a position exactly at the end of a table node', () => {
        const state = createMarkdownState(TABLE);

        expect(resolveContainingTableAtPos(state, TABLE.length)).toMatchObject({
            from: 0,
            to: TABLE.length,
        });
    });

    it('uses the exact Lezer range including a pipe-free trailing row', () => {
        const doc = `${TABLE}\ntrailing text`;
        const state = createMarkdownState(doc);

        expect(resolveContainingTableAtPos(state, TABLE.length)?.to).toBe(doc.length);
        expect(resolveTableContextAtPos(state, TABLE.length)?.cellRanges.rows).toHaveLength(2);
    });

    it("resolves a pipe-free row included in Lezer's table node", () => {
        const state = createMarkdownState(`${TABLE}\ntrailing text`);
        const trailingTextPos = TABLE.length + 1;

        expect(resolveContainingTableAtPos(state, trailingTextPos)?.from).toBe(0);
    });

    it('returns null outside a table', () => {
        const prefix = 'before\n\n';
        const state = createMarkdownState(`${prefix}${TABLE}`);

        expect(resolveContainingTableAtPos(state, 0)).toBeNull();
    });

    describe('with a second table following', () => {
        it('resolves the preceding table at its end rather than the table below', () => {
            const state = createMarkdownState(TWO_TABLES);

            expect(resolveContainingTableAtPos(state, TABLE.length)).toMatchObject({
                from: 0,
                to: TABLE.length,
            });
        });

        it('resolves the second table at its start', () => {
            const state = createMarkdownState(TWO_TABLES);

            expect(resolveContainingTableAtPos(state, SECOND_TABLE_FROM)).toMatchObject({
                from: SECOND_TABLE_FROM,
                to: SECOND_TABLE_FROM + SECOND_TABLE.length,
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

    /**
     * Regression coverage for a cursor escaping the table widget after undo.
     *
     * Undo can restore the cursor to a table's very last offset. The lifecycle classifier
     * decided "the cursor is inside a table" from `findTableRanges` containment and scheduled
     * an activation, but activation resolved the table from the cursor position and got null
     * there — so nothing was activated and the caret rendered outside the widget. The two
     * resolvers disagreeing about one position was the whole bug, so pin their agreement
     * across every offset rather than at hand-picked ones.
     */
    describe('agrees with findTableRanges at every document offset', () => {
        const cases: Record<string, string> = {
            'a lone table': TABLE,
            'two tables': TWO_TABLES,
            'a table with a pipe-free trailing row': `${TABLE}\ntrailing text`,
            'a table between paragraphs': `before\n\n${TABLE}\n\nafter`,
            'a document with no table': 'just a paragraph\n\nand another',
            'a table after a list': `- item\n\n${TABLE}`,
        };

        for (const [name, doc] of Object.entries(cases)) {
            it(`agrees for ${name}`, () => {
                const state = createMarkdownState(doc);
                const ranges = findTableRanges(state);
                if (!ranges) {
                    throw new Error('syntax tree unavailable for test document');
                }

                const disagreements: string[] = [];
                for (let pos = 0; pos <= doc.length; pos++) {
                    const fromPoint = resolveContainingTableAtPos(state, pos);
                    const fromScan = ranges.find((table) => pos >= table.from && pos <= table.to) ?? null;
                    if (fromPoint?.from !== fromScan?.from || fromPoint?.to !== fromScan?.to) {
                        disagreements.push(
                            `pos ${pos}: point=${describeRange(fromPoint)} scan=${describeRange(fromScan)}`
                        );
                    }
                }

                expect(disagreements).toEqual([]);
            });
        }
    });
});

describe('findTableRanges', () => {
    it('returns null when no syntax tree is available', () => {
        // A state without a markdown language never produces a syntax tree —
        // the same signal callers see when ensureSyntaxTree times out.
        const state = EditorState.create({ doc: TABLE });

        expect(findTableRanges(state)).toBeNull();
    });

    it('returns an empty array for a parsed document without tables', () => {
        const state = createMarkdownState('just a paragraph');

        expect(findTableRanges(state)).toEqual([]);
    });

    it('reuses one derivation for identical source text', () => {
        const state = createMarkdownState(`${TABLE}\n\n${TABLE}`);
        const tables = findTableRanges(state);

        expect(tables).toHaveLength(2);
        const [first, second] = (tables ?? []).map((table) => resolveTableContext(state, table));
        expect(second?.table).toBe(first?.table);
        expect(second?.cellRanges).toBe(first?.cellRanges);
    });

    it.each([
        ['blockquote', ['> | a | b |', '> | --- | --- |', '> | c | d |'].join('\n')],
        ['list item', ['- | a | b |', '  | --- | --- |', '  | c | d |'].join('\n')],
    ])('ignores a table nested in a %s', (_label, doc) => {
        const state = createMarkdownState(doc);

        expect(findTableRanges(state)).toEqual([]);
        expect(resolveContainingTableAtPos(state, doc.indexOf('a'))).toBeNull();
    });
});

function describeRange(table: { from: number; to: number } | null): string {
    return table ? `${table.from}-${table.to}` : 'null';
}

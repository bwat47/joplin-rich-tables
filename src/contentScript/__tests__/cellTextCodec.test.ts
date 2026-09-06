import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { sanitizeCellChanges, toLocalSelection, toRootSelection } from '../editorBridge/cellTextCodec';
import { MarkdownTable } from '../tableModel/MarkdownTable';

describe('selection mapping', () => {
    it('maps local selection to root selection across rewritten text', () => {
        const localText = 'a\nb|c';
        const rootSelection = toRootSelection({ anchor: 0, head: localText.length }, localText);

        expect(rootSelection).toEqual({ anchor: 0, head: String.raw`a<br>b\|c`.length });
    });

    it('maps root selection back to local selection', () => {
        const rootText = String.raw`a<br>b\|c`;
        const localSelection = toLocalSelection({ anchor: 0, head: rootText.length }, rootText);

        expect(localSelection).toEqual({ anchor: 0, head: 'a\nb|c'.length });
    });

    it('keeps a backward selection backward', () => {
        const localText = 'a\nb|c';

        expect(toRootSelection({ anchor: localText.length, head: 0 }, localText)).toEqual({
            anchor: String.raw`a<br>b\|c`.length,
            head: 0,
        });
    });

    it('puts a root caret inside a stored line break at the break itself', () => {
        // The nested editor shows `a\nb`, which has no position halfway through `<br>`.
        const rootText = String.raw`a<br>b`;

        expect(toLocalSelection({ anchor: 3, head: 3 }, rootText)).toEqual({ anchor: 1, head: 1 });
    });

    it('puts a root caret inside a pipe escape before the pipe it escapes', () => {
        const rootText = String.raw`a\|b`;

        expect(toLocalSelection({ anchor: 2, head: 2 }, rootText)).toEqual({ anchor: 1, head: 1 });
    });

    it('maps a root selection that starts and ends inside stored spellings', () => {
        const rootText = String.raw`a<br>b\|c`;

        // `a\nb|c`: both endpoints fall to the start of the spelling they landed in.
        expect(toLocalSelection({ anchor: 3, head: 7 }, rootText)).toEqual({ anchor: 1, head: 3 });
    });

    it('escapes a pipe the caret sits in front of without stranding the caret', () => {
        const localText = 'a|b';

        // `a\|b`: the caret stays in front of the escape, not between the backslash and the pipe.
        expect(toRootSelection({ anchor: 1, head: 1 }, localText)).toEqual({ anchor: 1, head: 1 });
        expect(toRootSelection({ anchor: 2, head: 2 }, localText)).toEqual({ anchor: 3, head: 3 });
    });

    it('clamps selections that reach past the text they are mapped from', () => {
        expect(toLocalSelection({ anchor: -5, head: 99 }, String.raw`a<br>b`)).toEqual({ anchor: 0, head: 3 });
    });

    it('keeps trailing-space cursor positions stable for root-owned commands', () => {
        const localText = 'sometext ';
        const rootSelection = toRootSelection({ anchor: localText.length, head: localText.length }, localText);

        expect(rootSelection).toEqual({ anchor: localText.length, head: localText.length });
    });

    it('keeps leading-space cursor positions stable for root-owned commands', () => {
        const localText = ' sometext';
        const rootSelection = toRootSelection({ anchor: 1, head: 1 }, localText);

        expect(rootSelection).toEqual({ anchor: 1, head: 1 });
    });

    it('keeps trailing-space cursor positions stable after normalizing a non-canonical table first', () => {
        const canonicalTable = MarkdownTable.parse(['|SOMETEXT|', '|---|'].join('\n'))?.serialize();
        expect(canonicalTable).toBe(['| SOMETEXT |', '| --- |'].join('\n'));
        if (!canonicalTable) {
            throw new Error('Expected canonical table text');
        }

        const cellFrom = canonicalTable.indexOf('SOMETEXT');
        const localText = 'SOMETEXT ';
        const rootSelection = toRootSelection({ anchor: localText.length, head: localText.length }, localText);
        const formatted = `${canonicalTable.slice(0, cellFrom + rootSelection.anchor)}****${canonicalTable.slice(
            cellFrom + rootSelection.head
        )}`;

        expect(formatted).toContain('SOMETEXT ****');
    });
});

describe('sanitizeCellChanges', () => {
    it('sanitizes direct main-editor paste inside the active cell', () => {
        const state = EditorState.create({
            doc: '| H1 |',
            selection: EditorSelection.single(2),
        });
        const tr = state.update({
            changes: { from: 2, to: 2, insert: 'a\nb|c' },
        });

        const result = sanitizeCellChanges(tr, 2, 4);
        expect(result.rejected).toBe(false);
        expect(result.didModifyInserts).toBe(true);
        expect(result.changes).toEqual([{ from: 2, to: 2, insert: String.raw`a<br>b\|c` }]);
    });

    it('canonicalizes self-closing br tags during direct main-editor paste', () => {
        const state = EditorState.create({
            doc: '| H1 |',
            selection: EditorSelection.single(2),
        });
        const tr = state.update({
            changes: { from: 2, to: 2, insert: 'a<br/>b|c' },
        });

        const result = sanitizeCellChanges(tr, 2, 4);
        expect(result.rejected).toBe(false);
        expect(result.didModifyInserts).toBe(true);
        expect(result.changes).toEqual([{ from: 2, to: 2, insert: String.raw`a<br>b\|c` }]);
    });

    it.each([
        { preceding: '\\', expectedInsert: '|', expectedDidModify: false },
        { preceding: '\\\\', expectedInsert: String.raw`\|`, expectedDidModify: true },
    ])(
        'escapes an inserted pipe against a preceding "$preceding" run',
        ({ preceding, expectedInsert, expectedDidModify }) => {
            const doc = `| H${preceding} |`;
            const insertAt = doc.indexOf(' |');
            const state = EditorState.create({
                doc,
                selection: EditorSelection.single(insertAt),
            });
            const tr = state.update({ changes: { from: insertAt, insert: '|' } });

            const result = sanitizeCellChanges(tr, 2, insertAt);

            expect(result.rejected).toBe(false);
            expect(result.didModifyInserts).toBe(expectedDidModify);
            expect(result.changes).toEqual([{ from: insertAt, to: insertAt, insert: expectedInsert }]);
        }
    );
});

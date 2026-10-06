import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { sanitizeCellChanges } from '../tableRuntime/sanitizeCellChanges';

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

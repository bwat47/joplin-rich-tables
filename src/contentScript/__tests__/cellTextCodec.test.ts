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
        { preceding: '\\', expectedInsert: '|' },
        { preceding: '\\\\', expectedInsert: String.raw`\|` },
    ])('escapes an inserted pipe against a preceding "$preceding" run', ({ preceding, expectedInsert }) => {
        const doc = `| H${preceding} |`;
        const insertAt = doc.indexOf(' |');
        const state = EditorState.create({
            doc,
            selection: EditorSelection.single(insertAt),
        });
        const tr = state.update({ changes: { from: insertAt, insert: '|' } });

        const result = sanitizeCellChanges(tr, 2, insertAt);

        expect(result.rejected).toBe(false);
        expect(result.changes).toEqual([{ from: insertAt, to: insertAt, insert: expectedInsert }]);
    });
});

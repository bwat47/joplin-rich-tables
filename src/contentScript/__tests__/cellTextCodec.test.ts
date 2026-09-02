import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import {
    convertNewlinesToBr,
    escapeUnescapedPipes,
    sanitizeCellChanges,
    toLocalSelection,
    toRootSelection,
    unsanitizeRootText,
} from '../editorBridge/cellTextCodec';
import { normalizeBrTags, sanitizeLocalText } from '../shared/cellTextNormalization';
import { MarkdownTable } from '../tableModel/MarkdownTable';

describe('escapeUnescapedPipes', () => {
    it('escapes unescaped pipes', () => {
        expect(escapeUnescapedPipes('a|b')).toBe(String.raw`a\|b`);
        expect(escapeUnescapedPipes('|')).toBe(String.raw`\|`);
        expect(escapeUnescapedPipes('a|b|c')).toBe(String.raw`a\|b\|c`);
    });

    it('keeps already-escaped pipes intact', () => {
        expect(escapeUnescapedPipes(String.raw`a\|b`)).toBe(String.raw`a\|b`);
    });
});

describe('convertNewlinesToBr', () => {
    it('converts LF and CRLF to <br>', () => {
        expect(convertNewlinesToBr('a\nb')).toBe('a<br>b');
        expect(convertNewlinesToBr('a\r\nb')).toBe('a<br>b');
    });
});

describe('normalizeBrTags', () => {
    it('canonicalizes self-closing br tags to <br>', () => {
        expect(normalizeBrTags('a<br/>b')).toBe('a<br>b');
        expect(normalizeBrTags('a<br />b')).toBe('a<br>b');
        expect(normalizeBrTags('a<BR/>b')).toBe('a<br>b');
    });
});

describe('sanitizeLocalText / unsanitizeRootText', () => {
    it('converts local newlines and pipes to markdown-safe cell text', () => {
        expect(sanitizeLocalText('a\nb|c')).toBe(String.raw`a<br>b\|c`);
    });

    it('normalizes self-closing br tags before syncing to root text', () => {
        expect(sanitizeLocalText('a<br/>b|c')).toBe(String.raw`a<br>b\|c`);
        expect(sanitizeLocalText('a<br />b|c')).toBe(String.raw`a<br>b\|c`);
    });

    it('preserves trailing spaces during live editing sync', () => {
        expect(sanitizeLocalText('sometext ')).toBe('sometext ');
    });

    it('converts root markdown-safe cell text back to local display text', () => {
        expect(unsanitizeRootText(String.raw`a<br>b\|c`)).toBe('a\nb|c');
    });
});

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
});

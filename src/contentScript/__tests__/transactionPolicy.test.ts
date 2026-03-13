import { describe, expect, it } from '@jest/globals';
import { EditorSelection, EditorState } from '@codemirror/state';
import {
    convertNewlinesToBr,
    escapeUnescapedPipes,
    sanitizeCellChanges,
    sanitizeLocalText,
    toLocalSelection,
    toRootSelection,
    unsanitizeRootText,
} from '../nestedEditor/transactionPolicy';

describe('escapeUnescapedPipes', () => {
    it('escapes unescaped pipes', () => {
        expect(escapeUnescapedPipes('a|b')).toBe('a\\|b');
        expect(escapeUnescapedPipes('|')).toBe('\\|');
        expect(escapeUnescapedPipes('a|b|c')).toBe('a\\|b\\|c');
    });

    it('keeps already-escaped pipes intact', () => {
        expect(escapeUnescapedPipes('a\\|b')).toBe('a\\|b');
    });
});

describe('convertNewlinesToBr', () => {
    it('converts LF and CRLF to <br>', () => {
        expect(convertNewlinesToBr('a\nb')).toBe('a<br>b');
        expect(convertNewlinesToBr('a\r\nb')).toBe('a<br>b');
    });
});

describe('sanitizeLocalText / unsanitizeRootText', () => {
    it('converts local newlines and pipes to markdown-safe cell text', () => {
        expect(sanitizeLocalText('a\nb|c')).toBe('a<br>b\\|c');
    });

    it('converts root markdown-safe cell text back to local display text', () => {
        expect(unsanitizeRootText('a<br>b\\|c')).toBe('a\nb|c');
    });
});

describe('selection mapping', () => {
    it('maps local selection to root selection across rewritten text', () => {
        const localText = 'a\nb|c';
        const rootSelection = toRootSelection({ anchor: 0, head: localText.length }, localText);

        expect(rootSelection).toEqual({ anchor: 0, head: 'a<br>b\\|c'.length });
    });

    it('maps root selection back to local selection', () => {
        const rootText = 'a<br>b\\|c';
        const localSelection = toLocalSelection({ anchor: 0, head: rootText.length }, rootText);

        expect(localSelection).toEqual({ anchor: 0, head: 'a\nb|c'.length });
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
        expect(result.changes).toEqual([{ from: 2, to: 2, insert: 'a<br>b\\|c' }]);
    });
});

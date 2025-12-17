import { describe, expect, it } from '@jest/globals';
import { EditorState } from '@codemirror/state';
import {
    convertNewlinesToBr,
    createCellTransactionFilter,
    createSubviewCellRangeField,
    escapeUnescapedPipes,
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

    it('escapes pipes preceded by an even backslash run', () => {
        // Two backslashes means the pipe is still a delimiter in Markdown; add one more.
        expect(escapeUnescapedPipes('a\\\\|b')).toBe('a\\\\\\|b');
    });
});

describe('convertNewlinesToBr', () => {
    it('converts LF and CRLF to <br>', () => {
        expect(convertNewlinesToBr('a\nb')).toBe('a<br>b');
        expect(convertNewlinesToBr('a\r\nb')).toBe('a<br>b');
        expect(convertNewlinesToBr('a\r\nb\r\nc')).toBe('a<br>b<br>c');
    });
});

describe('createCellTransactionFilter', () => {
    it('sanitizes inserted newlines to <br> within cell range', () => {
        const doc = 'abc';
        const rangeField = createSubviewCellRangeField({ from: 0, to: doc.length });

        let state = EditorState.create({
            doc,
            selection: { anchor: 1 },
            extensions: [rangeField, createCellTransactionFilter(rangeField)],
        });

        const tr = state.update({ changes: { from: 1, to: 1, insert: 'x\ny' } });
        state = tr.state;

        expect(state.doc.toString()).toBe('ax<br>ybc');
        expect(state.selection.main.head).toBe(1 + 'x<br>y'.length);
    });

    it('keeps caret after escaped pipe insertion', () => {
        const doc = 'abc';
        const rangeField = createSubviewCellRangeField({ from: 0, to: doc.length });

        let state = EditorState.create({
            doc,
            selection: { anchor: 1 },
            extensions: [rangeField, createCellTransactionFilter(rangeField)],
        });

        const tr = state.update({ changes: { from: 1, to: 1, insert: '|' } });
        state = tr.state;

        expect(state.doc.toString()).toBe('a\\|bc');
        expect(state.selection.main.head).toBe(3);
    });

    it('does not add an extra backslash when user already typed one', () => {
        const doc = 'a\\bc';
        const rangeField = createSubviewCellRangeField({ from: 0, to: doc.length });

        let state = EditorState.create({
            doc,
            selection: { anchor: 2 },
            extensions: [rangeField, createCellTransactionFilter(rangeField)],
        });

        // Simulate a typical typing transaction, where the selection is already placed
        // after the inserted character by the input handler.
        const tr = state.update({ changes: { from: 2, to: 2, insert: '|' }, selection: { anchor: 3 } });
        state = tr.state;

        expect(state.doc.toString()).toBe('a\\|bc');
        expect(state.selection.main.head).toBe(3);
    });
});

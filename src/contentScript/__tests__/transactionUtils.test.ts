import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { changesOverlapRange } from '../shared/transactionUtils';

const FROM = 10;
const TO = 50;

function changeTransaction(spec: { from: number; to?: number; insert?: string }) {
    return EditorState.create({ doc: 'x'.repeat(100) }).update({ changes: spec });
}

describe('changesOverlapRange', () => {
    it.each([
        ['an insertion at the start', { from: FROM, insert: 'x' }, false],
        ['an insertion at the end', { from: TO, insert: 'x' }, false],
        ['a deletion ending at the start', { from: FROM - 1, to: FROM }, false],
        ['a deletion starting at the end', { from: TO, to: TO + 1 }, false],
        ['an interior replacement', { from: FROM + 1, to: FROM + 2, insert: 'x' }, true],
        ['an edit before the range', { from: 2, to: 4, insert: 'x' }, false],
        ['an edit after the range', { from: 60, to: 62, insert: 'x' }, false],
    ])('%s', (_name, spec, overlaps) => {
        expect(changesOverlapRange(changeTransaction(spec), FROM, TO)).toBe(overlaps);
    });
});

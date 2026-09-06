import { EditorSelection } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
    areSelectionsEqual,
    resolveInitialLocalSelection,
    toAbsoluteSelection,
    toRelativeSelection,
} from '../nestedEditor/nestedEditorSelection';
import { cellTextCaret } from '../shared/cursorPlacement';

describe('toAbsoluteSelection', () => {
    it('shifts a cell-relative selection by the editable start', () => {
        expect(toAbsoluteSelection({ anchor: 2, head: 5 }, 10)).toEqual({ anchor: 12, head: 15 });
    });

    it('preserves a reversed selection', () => {
        expect(toAbsoluteSelection({ anchor: 5, head: 2 }, 10)).toEqual({ anchor: 15, head: 12 });
    });
});

describe('toRelativeSelection', () => {
    it('maps a selection inside the cell to cell-relative offsets', () => {
        expect(toRelativeSelection(EditorSelection.single(12, 15), 10, 20)).toEqual({ anchor: 2, head: 5 });
    });

    it('clamps a selection that starts before the cell', () => {
        expect(toRelativeSelection(EditorSelection.single(3, 15), 10, 20)).toEqual({ anchor: 0, head: 5 });
    });

    it('clamps a selection that runs past the cell end', () => {
        expect(toRelativeSelection(EditorSelection.single(12, 40), 10, 20)).toEqual({ anchor: 2, head: 10 });
    });

    it('collapses a selection entirely outside the cell to the nearest edge', () => {
        expect(toRelativeSelection(EditorSelection.single(30, 35), 10, 20)).toEqual({ anchor: 10, head: 10 });
    });

    it('uses the main range when the selection has several ranges', () => {
        const selection = EditorSelection.create([EditorSelection.range(1, 2), EditorSelection.range(12, 14)], 1);
        expect(toRelativeSelection(selection, 10, 20)).toEqual({ anchor: 2, head: 4 });
    });
});

describe('areSelectionsEqual', () => {
    it('is true for identical anchor and head', () => {
        expect(areSelectionsEqual({ anchor: 1, head: 4 }, { anchor: 1, head: 4 })).toBe(true);
    });

    it('distinguishes selection direction', () => {
        expect(areSelectionsEqual({ anchor: 1, head: 4 }, { anchor: 4, head: 1 })).toBe(false);
    });
});

describe('resolveInitialLocalSelection', () => {
    const mirrored = { anchor: 3, head: 6 };

    it('keeps the mirrored selection when no placement is requested', () => {
        expect(resolveInitialLocalSelection(mirrored, 'hello world')).toEqual(mirrored);
    });

    it('collapses to the start of the cell text', () => {
        expect(resolveInitialLocalSelection(mirrored, 'hello world', 'start')).toEqual({ anchor: 0, head: 0 });
    });

    it('collapses to the end of the cell text', () => {
        expect(resolveInitialLocalSelection(mirrored, 'hello', 'end')).toEqual({ anchor: 5, head: 5 });
    });

    it('collapses to the start of the last line for multi-line cell text', () => {
        expect(resolveInitialLocalSelection(mirrored, 'first\nsecond\nthird', 'lastLineStart')).toEqual({
            anchor: 13,
            head: 13,
        });
    });

    it('collapses to the start for lastLineStart when the cell text has one line', () => {
        expect(resolveInitialLocalSelection(mirrored, 'only line', 'lastLineStart')).toEqual({ anchor: 0, head: 0 });
    });

    it('places the caret after a trailing newline for lastLineStart', () => {
        expect(resolveInitialLocalSelection(mirrored, 'first\n', 'lastLineStart')).toEqual({ anchor: 6, head: 6 });
    });

    it('collapses to a requested offset in the cell text', () => {
        expect(resolveInitialLocalSelection(mirrored, 'hello world', cellTextCaret(4))).toEqual({
            anchor: 4,
            head: 4,
        });
    });

    it('clamps both initial selection endpoints while retaining direction', () => {
        expect(
            resolveInitialLocalSelection(mirrored, 'hello', {
                localSelection: { anchor: 8, head: -2 },
            })
        ).toEqual({ anchor: 5, head: 0 });
    });

    it('clamps a requested offset the cell text can no longer hold', () => {
        // The offset is decided against the cell as it stood; an entry that repairs the table
        // into canonical form can restripe that cell's padding in the same transaction.
        expect(resolveInitialLocalSelection(mirrored, 'hi', cellTextCaret(9))).toEqual({ anchor: 2, head: 2 });
        expect(resolveInitialLocalSelection(mirrored, 'hi', cellTextCaret(-1))).toEqual({ anchor: 0, head: 0 });
    });
});

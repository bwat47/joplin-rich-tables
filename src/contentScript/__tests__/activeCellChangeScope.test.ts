import { ChangeSet } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { classifyActiveCellChanges, type ActiveCellSpan } from '../tableRuntime/activeCell/activeCellChangeScope';

const DOC_LENGTH = 100;
const SPAN: ActiveCellSpan = {
    ctx: { from: 10, to: 50 },
    editableFrom: 20,
    editableTo: 30,
};

function changes(specs: { from: number; to?: number; insert?: string }[]): ChangeSet {
    return ChangeSet.of(specs, DOC_LENGTH);
}

describe('classifyActiveCellChanges', () => {
    it.each([
        ['an empty change set', ChangeSet.empty(DOC_LENGTH)],
        ['an insertion at the editable start', changes([{ from: 20, insert: 'x' }])],
        ['an insertion at the editable end', changes([{ from: 30, insert: 'x' }])],
        ['a replacement within the editable span', changes([{ from: 22, to: 25, insert: 'x' }])],
    ])('classifies %s as inCell', (_name, changeSet) => {
        expect(classifyActiveCellChanges(changeSet, SPAN)).toBe('inCell');
    });

    it.each([
        ['an edit before the table', changes([{ from: 2, to: 4, insert: 'x' }])],
        ['an edit after the table', changes([{ from: 60, to: 62, insert: 'x' }])],
        [
            'an in-cell edit combined with an outside edit',
            changes([
                { from: 2, to: 4, insert: 'x' },
                { from: 22, to: 24, insert: 'y' },
            ]),
        ],
    ])('classifies %s as outsideTable', (_name, changeSet) => {
        expect(classifyActiveCellChanges(changeSet, SPAN)).toBe('outsideTable');
    });

    it.each([
        ['an insertion at the table start', changes([{ from: 10, insert: 'x' }])],
        ['an insertion at the table end', changes([{ from: 50, insert: 'x' }])],
        ['a delimiter edit', changes([{ from: 15, to: 16, insert: 'x' }])],
        ['an edit in another cell', changes([{ from: 35, to: 36, insert: 'x' }])],
        [
            'an in-cell edit combined with another-cell edit',
            changes([
                { from: 22, to: 24, insert: 'x' },
                { from: 35, to: 36, insert: 'y' },
            ]),
        ],
    ])('classifies %s as touchesTable', (_name, changeSet) => {
        expect(classifyActiveCellChanges(changeSet, SPAN)).toBe('touchesTable');
    });
});

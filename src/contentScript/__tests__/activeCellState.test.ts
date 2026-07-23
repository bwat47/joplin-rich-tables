import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { activeCellField, getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';

const DOC = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');

function headerCell(tableFrom: number): ActiveCell {
    return { tableFrom, section: 'header', row: 0, col: 0 };
}

function createState(activeCell: ActiveCell) {
    const state = EditorState.create({ doc: DOC, extensions: [activeCellField] });
    return state.update({ effects: setActiveCellEffect.of(activeCell) }).state;
}

describe('activeCellField', () => {
    it('maps tableFrom through document changes', () => {
        const state = createState(headerCell(0));

        const tr = state.update({ changes: { from: 0, to: 0, insert: 'before\n' } });

        expect(getActiveCell(tr.state)?.tableFrom).toBe('before\n'.length);
    });

    it('drops an anchor pointing past the end of the pre-change document', () => {
        const state = createState(headerCell(DOC.length + 10));

        const tr = state.update({ changes: { from: 0, to: 0, insert: 'x' } });

        expect(getActiveCell(tr.state)).toBeNull();
        expect(tr.state.doc.toString()).toBe(`x${DOC}`);
    });

    it('drops a negative anchor', () => {
        const state = createState(headerCell(-1));

        const tr = state.update({ changes: { from: 0, to: 0, insert: 'x' } });

        expect(getActiveCell(tr.state)).toBeNull();
    });

    it('keeps an out-of-range anchor untouched when the document does not change', () => {
        const state = createState(headerCell(DOC.length + 10));

        const tr = state.update({ selection: { anchor: 1 } });

        expect(getActiveCell(tr.state)?.tableFrom).toBe(DOC.length + 10);
    });
});

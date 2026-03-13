import { describe, expect, it } from '@jest/globals';
import { EditorState } from '@codemirror/state';
import { activeCellField, setActiveCellEffect, type ActiveCell } from '../tableWidget/activeCellState';
import { resolveActiveCell, resolveCurrentActiveCell } from '../tableWidget/activeCellResolver';

function createState(doc: string, activeCell?: ActiveCell) {
    let state = EditorState.create({
        doc,
        extensions: [activeCellField],
    });

    if (activeCell) {
        state = state.update({ effects: setActiveCellEffect.of(activeCell) }).state;
    }

    return state;
}

describe('activeCellResolver', () => {
    it('resolves header cells from logical active-cell state', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const state = createState(doc, {
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 1,
        });

        const resolved = resolveCurrentActiveCell(state);

        expect(resolved).not.toBeNull();
        expect(resolved?.cellFrom).toBe(doc.indexOf('H2'));
        expect(resolved?.cellTo).toBe(doc.indexOf('H2') + 2);
    });

    it('tracks tableFrom when text is inserted before the table', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const state = createState(doc, {
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 0,
        });

        const tr = state.update({
            changes: { from: 0, to: 0, insert: 'before\n' },
        });
        const resolved = resolveCurrentActiveCell(tr.state);

        expect(resolved).not.toBeNull();
        expect(tr.state.field(activeCellField)?.tableFrom).toBe('before\n'.length);
        expect(resolved?.tableFrom).toBe('before\n'.length);
        expect(tr.state.doc.sliceString(resolved!.cellFrom, resolved!.cellTo)).toBe('H1');
    });

    it('returns null when the anchored table no longer exists', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const state = createState(doc, {
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 0,
        });

        const tr = state.update({
            changes: { from: 0, to: doc.length, insert: '# replaced' },
        });

        expect(resolveCurrentActiveCell(tr.state)).toBeNull();
    });

    it('returns null when the logical cell no longer exists in the anchored table', () => {
        const startDoc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '| b1 | b2 |'].join('\n');
        const state = createState(startDoc, {
            tableFrom: 0,
            section: 'body',
            row: 1,
            col: 0,
        });
        const nextDoc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');

        const tr = state.update({
            changes: { from: 0, to: startDoc.length, insert: nextDoc },
        });

        expect(resolveActiveCell(tr.state, tr.state.field(activeCellField))).toBeNull();
    });
});

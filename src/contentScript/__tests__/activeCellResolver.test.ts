import { describe, expect, it } from '@jest/globals';
import { activeCellField, getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { resolveActiveCell } from '../tableRuntime/activeCellResolver';
import { createMarkdownState } from './testMarkdownState';

function createState(doc: string, activeCell?: ActiveCell) {
    let state = createMarkdownState(doc, [activeCellField]);

    if (activeCell) {
        state = state.update({ effects: setActiveCellEffect.of(activeCell) }).state;
    }

    return state;
}

describe('activeCellResolver', () => {
    it('resolves header cells from logical active-cell state', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const state = createState(doc, {
            anchorPos: doc.indexOf('H2'),
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 1,
        });

        const resolved = resolveActiveCell(state, getActiveCell(state));

        expect(resolved).not.toBeNull();
        expect(resolved?.cellFrom).toBe(doc.indexOf('H2'));
        expect(resolved?.cellTo).toBe(doc.indexOf('H2') + 2);
    });

    it('tracks tableFrom when text is inserted before the table', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const state = createState(doc, {
            anchorPos: doc.indexOf('H1'),
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 0,
        });

        const tr = state.update({
            changes: { from: 0, to: 0, insert: 'before\n' },
        });
        const resolved = resolveActiveCell(tr.state, getActiveCell(tr.state));

        expect(resolved).not.toBeNull();
        expect(tr.state.field(activeCellField)?.tableFrom).toBe('before\n'.length);
        expect(resolved?.tableFrom).toBe('before\n'.length);
        expect(tr.state.doc.sliceString(resolved!.cellFrom, resolved!.cellTo)).toBe('H1');
    });

    it('returns null when the anchored table no longer exists', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const state = createState(doc, {
            anchorPos: doc.indexOf('H1'),
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 0,
        });

        const tr = state.update({
            changes: { from: 0, to: doc.length, insert: '# replaced' },
        });

        expect(resolveActiveCell(tr.state, getActiveCell(tr.state))).toBeNull();
    });

    it('returns null when the logical cell no longer exists in the anchored table', () => {
        const startDoc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '| b1 | b2 |'].join('\n');
        const state = createState(startDoc, {
            anchorPos: startDoc.indexOf('b1'),
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

    it('extends the resolved cell range across trailing whitespace that contains the selection', () => {
        const doc = ['| foo  |', '| --- |'].join('\n');
        const trailingSpaceCursor = doc.indexOf('foo') + 'foo '.length;
        const state = createState(doc, {
            anchorPos: doc.indexOf('foo'),
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 0,
        }).update({
            selection: { anchor: trailingSpaceCursor },
        }).state;

        const resolved = resolveActiveCell(state, getActiveCell(state));

        expect(resolved).not.toBeNull();
        expect(resolved?.cellFrom).toBe(doc.indexOf('foo'));
        expect(resolved?.cellTo).toBe(doc.indexOf('|', doc.indexOf('foo')));
        expect(state.doc.sliceString(resolved!.cellFrom, resolved!.cellTo)).toBe('foo  ');
    });

    it('prefers the mapped table start over a drifted anchor when another table follows', () => {
        const doc = [
            '| H1 | H2 |',
            '| --- | --- |',
            '| a1 |  |',
            '',
            '|  | Bands |',
            '| --- | :--- |',
            '| **2G:** | `GSM 850 / 900 / 1800 / 1900 CDMA 800` a |',
        ].join('\n');
        const state = createState(doc, {
            anchorPos: doc.indexOf('|  | Bands |'),
            tableFrom: 0,
            section: 'body',
            row: 0,
            col: 1,
        });

        const resolved = resolveActiveCell(state, getActiveCell(state));

        expect(resolved).not.toBeNull();
        expect(resolved?.tableFrom).toBe(0);
        expect(resolved?.activeCell.section).toBe('body');
        expect(resolved?.activeCell.row).toBe(0);
        expect(resolved?.activeCell.col).toBe(1);
        expect(state.doc.sliceString(resolved!.cellFrom, resolved!.cellTo)).toBe('');
    });
});

import { describe, expect, it } from '@jest/globals';
import { activeCellField, getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { resolveActiveCell } from '../tableRuntime/activeCell/activeCellResolver';
import { getResolvedActiveCell, resolvedActiveCellField } from '../tableRuntime/activeCell/resolvedActiveCellField';
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
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 1,
        });

        const resolved = resolveActiveCell(state, getActiveCell(state));

        expect(resolved).not.toBeNull();
        expect(resolved?.contentFrom).toBe(doc.indexOf('H2'));
        expect(resolved?.contentTo).toBe(doc.indexOf('H2') + 2);
        expect(resolved?.editableFrom).toBe(doc.indexOf('H2'));
        expect(resolved?.editableTo).toBe(doc.indexOf('H2') + 2);
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
        const resolved = resolveActiveCell(tr.state, getActiveCell(tr.state));

        expect(resolved).not.toBeNull();
        expect(tr.state.field(activeCellField)?.tableFrom).toBe('before\n'.length);
        expect(resolved?.tableFrom).toBe('before\n'.length);
        expect(tr.state.doc.sliceString(resolved!.contentFrom, resolved!.contentTo)).toBe('H1');
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

        expect(resolveActiveCell(tr.state, getActiveCell(tr.state))).toBeNull();
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

    it('returns separate content and editable spans for edge whitespace', () => {
        const doc = ['|  foo  |', '| --- |'].join('\n');
        const state = createState(doc, {
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 0,
        });

        const resolved = resolveActiveCell(state, getActiveCell(state));

        expect(resolved).not.toBeNull();
        expect(resolved?.contentFrom).toBe(doc.indexOf('foo'));
        expect(resolved?.contentTo).toBe(doc.indexOf('foo') + 'foo'.length);
        expect(resolved?.editableFrom).toBe(doc.indexOf('foo') - 1);
        expect(resolved?.editableTo).toBe(doc.indexOf('foo') + 'foo '.length);
        expect(state.doc.sliceString(resolved!.contentFrom, resolved!.contentTo)).toBe('foo');
        expect(state.doc.sliceString(resolved!.editableFrom, resolved!.editableTo)).toBe(' foo ');
    });

    it('is selection-independent even when the cursor moves into editable edge whitespace', () => {
        const doc = ['| foo  |', '| --- |'].join('\n');
        const state = createState(doc, {
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 0,
        });
        const withSelection = state.update({
            selection: { anchor: doc.indexOf('foo') + 'foo '.length },
        }).state;

        const resolved = resolveActiveCell(state, getActiveCell(state));
        const resolvedWithSelection = resolveActiveCell(withSelection, getActiveCell(withSelection));

        expect(resolved).not.toBeNull();
        expect(resolvedWithSelection).not.toBeNull();
        expect(resolvedWithSelection).toEqual(resolved);
    });

    it('reuses the cached resolved active cell across selection-only updates', () => {
        let state = createMarkdownState(['| foo  |', '| --- |'].join('\n'), [activeCellField, resolvedActiveCellField]);
        state = state.update({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'header',
                row: 0,
                col: 0,
            }),
        }).state;

        const initialResolved = getResolvedActiveCell(state);
        const nextState = state.update({
            selection: { anchor: state.doc.toString().indexOf('foo') + 'foo '.length },
        }).state;
        const nextResolved = getResolvedActiveCell(nextState);

        expect(initialResolved).not.toBeNull();
        expect(nextResolved).toBe(initialResolved);
    });

    it('resolves the anchored table from tableFrom when another table follows', () => {
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
        expect(state.doc.sliceString(resolved!.contentFrom, resolved!.contentTo)).toBe('');
    });
});

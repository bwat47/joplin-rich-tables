import { describe, expect, it } from 'vitest';
import { activeCellField, getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import {
    createResolvedActiveCell,
    resolveActiveCell,
    resolveCellWithinResolvedTable,
} from '../tableRuntime/activeCell/resolvedActiveCell';
import { getResolvedActiveCell, resolvedActiveCellField } from '../tableRuntime/activeCell/resolvedActiveCell';
import { createMarkdownState } from './testMarkdownState';
import { buildTableContext } from '../tableModel/tableContext';
import { parseRootMarkdownTableSyntax } from '../tableModel/lezerTableSyntax';

function buildContext(text: string) {
    const parsed = parseRootMarkdownTableSyntax(text);
    if (!parsed) {
        throw new Error('Expected root table syntax');
    }

    return buildTableContext({
        from: parsed.from,
        to: parsed.to,
        text: text.slice(parsed.from, parsed.to),
        syntax: parsed.syntax,
    });
}

function createState(doc: string, activeCell?: ActiveCell) {
    let state = createMarkdownState(doc, [activeCellField]);

    if (activeCell) {
        state = state.update({ effects: setActiveCellEffect.of(activeCell) }).state;
    }

    return state;
}

describe('resolvedActiveCell', () => {
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

    it('returns null for an anchor outside the document', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const state = createState(doc);

        for (const tableFrom of [-1, doc.length + 1, doc.length + 10]) {
            expect(resolveActiveCell(state, { tableFrom, section: 'header', row: 0, col: 0 })).toBeNull();
        }
    });

    it('resolves an in-document anchor that no longer points at the table start', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const state = createState(doc);

        const resolved = resolveActiveCell(state, {
            tableFrom: doc.indexOf('a1'),
            section: 'header',
            row: 0,
            col: 0,
        });

        expect(resolved?.tableFrom).toBe(0);
        expect(state.doc.sliceString(resolved!.contentFrom, resolved!.contentTo)).toBe('H1');
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

    it('creates a resolved active cell directly from table context and coords', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const ctx = buildContext(doc);

        expect(ctx).not.toBeNull();
        if (!ctx) {
            throw new Error('Expected table context');
        }

        const resolved = createResolvedActiveCell({
            ctx,
            coords: { section: 'body', row: 0, col: 1 },
        });

        expect(resolved).not.toBeNull();
        expect(resolved?.activeCell).toEqual({
            tableFrom: 0,
            section: 'body',
            row: 0,
            col: 1,
        });
        expect(resolved?.tableFrom).toBe(0);
        expect(resolved?.tableTo).toBe(doc.length);
        expect(resolved?.contentFrom).toBe(doc.indexOf('a2'));
        expect(resolved?.contentTo).toBe(doc.indexOf('a2') + 2);
        expect(resolved?.editableFrom).toBe(doc.indexOf('a2'));
        expect(resolved?.editableTo).toBe(doc.indexOf('a2') + 2);
    });

    it('resolves a cell within the same resolved table context without reparsing', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const state = createState(doc, {
            tableFrom: 0,
            section: 'header',
            row: 0,
            col: 0,
        });

        const resolved = resolveActiveCell(state, getActiveCell(state));
        expect(resolved).not.toBeNull();
        if (!resolved) {
            throw new Error('Expected resolved cell');
        }

        const resolvedCell = resolveCellWithinResolvedTable(resolved, {
            section: 'body',
            row: 0,
            col: 1,
        });

        expect(resolvedCell).not.toBeNull();
        expect(resolvedCell?.ctx).toBe(resolved.ctx);
        expect(resolvedCell?.activeCell).toEqual({
            tableFrom: 0,
            section: 'body',
            row: 0,
            col: 1,
        });
        expect(resolvedCell?.editableFrom).toBe(doc.indexOf('a2'));
        expect(resolvedCell?.editableTo).toBe(doc.indexOf('a2') + 2);
    });

    it('returns null when creating a resolved active cell for invalid coordinates', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const ctx = buildContext(doc);

        expect(ctx).not.toBeNull();
        if (!ctx) {
            throw new Error('Expected table context');
        }

        expect(
            createResolvedActiveCell({
                ctx,
                coords: { section: 'body', row: 9, col: 9 },
            })
        ).toBeNull();
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

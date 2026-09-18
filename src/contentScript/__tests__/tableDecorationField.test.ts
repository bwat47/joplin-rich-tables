import { ensureSyntaxTree } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState, StateEffect, Transaction } from '@codemirror/state';
import type { Decoration } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { describe, expect, it, vi } from 'vitest';
import {
    isTableRenderingActive,
    tableDecorationField,
    wasActiveHostInvalidated,
} from '../tableWidget/tableDecorationField';
import { tableContextField } from '../tableState/tableContextField';
import { activeCellField, clearActiveCellEffect, setActiveCellEffect } from '../tableState/activeCellState';
import { rebuildAllTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { getResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { createMarkdownState } from './testMarkdownState';
import { triggerOpenCellRequestEffect } from '../tableRuntime/openCellRequest';

const TABLE_COUNT = 5;
const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');
const FILLER = 'lorem ipsum dolor sit amet '.repeat(40);
const LONG_TABLE_DOCUMENT = Array.from({ length: TABLE_COUNT }, () => `${FILLER}\n\n${TABLE}`).join('\n\n');
const CLOCK_ADVANCE_MS = 2_000;
const COMPLETE_PARSE_TIMEOUT_MS = 1_000;

function getDecorationAt(state: EditorState, from: number, to: number): Decoration {
    let result: Decoration | null = null;
    state.field(tableDecorationField).decorations.between(from, to, (rangeFrom, rangeTo, decoration) => {
        if (rangeFrom === from && rangeTo === to) {
            result = decoration;
        }
    });
    if (!result) {
        throw new Error(`Expected decoration at ${from}-${to}`);
    }
    return result;
}

function forceState(_state: EditorState): null {
    return null;
}

describe('tableDecorationField', () => {
    it('registers into an existing editor whose transaction extenders force the new state', () => {
        const forceStateExtender = EditorState.transactionExtender.of((transaction) => {
            return forceState(transaction.state);
        });
        const state = EditorState.create({
            doc: TABLE,
            extensions: [markdown({ extensions: [GFM] }), forceStateExtender],
        });

        const registration = state.update({
            effects: StateEffect.appendConfig.of([tableContextField, activeCellField, tableDecorationField]),
        });

        expect(() => registration.state).not.toThrow();
        expect(registration.state.field(tableDecorationField).decorations.size).toBe(1);
    });

    it('rebuilds incomplete decorations when parsing finishes without a document change', () => {
        // CodeMirror checks Date.now between parser steps. Advancing the clock beyond the
        // production budget on every check forces a deterministic timeout.
        let now = 0;
        const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => {
            now += CLOCK_ADVANCE_MS;
            return now;
        });

        let state: EditorState;
        try {
            state = createMarkdownState(LONG_TABLE_DOCUMENT, [tableDecorationField]);
        } finally {
            dateNow.mockRestore();
        }

        expect(state.field(tableDecorationField)).toMatchObject({
            decorations: { size: 0 },
            rendering: false,
        });
        expect(state.field(tableContextField).treeIncomplete).toBe(true);

        expect(ensureSyntaxTree(state, state.doc.length, COMPLETE_PARSE_TIMEOUT_MS)).not.toBeNull();

        // ensureSyntaxTree advances the shared parse context. A subsequent empty transaction
        // exposes that completed tree, as CodeMirror's background parser does when it dispatches.
        const parserUpdate = state.update({});
        expect(parserUpdate.docChanged).toBe(false);
        state = parserUpdate.state;

        expect(state.field(tableDecorationField)).toMatchObject({
            decorations: { size: TABLE_COUNT },
            rendering: true,
        });
        expect(state.field(tableContextField).treeIncomplete).toBe(false);
    });

    it('resolves the active cell after parser recovery without an activation change', () => {
        let now = 0;
        const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => {
            now += CLOCK_ADVANCE_MS;
            return now;
        });

        let state: EditorState;
        try {
            state = createMarkdownState(LONG_TABLE_DOCUMENT, [activeCellField]);
            state = state.update({
                effects: setActiveCellEffect.of({
                    tableFrom: FILLER.length + 2,
                    section: 'header',
                    row: 0,
                    col: 0,
                }),
            }).state;
        } finally {
            dateNow.mockRestore();
        }

        expect(state.field(tableContextField).treeIncomplete).toBe(true);
        expect(getResolvedActiveCell(state)).toBeNull();

        expect(ensureSyntaxTree(state, state.doc.length, COMPLETE_PARSE_TIMEOUT_MS)).not.toBeNull();
        state = state.update({}).state;

        expect(state.field(tableContextField).treeIncomplete).toBe(false);
        expect(getResolvedActiveCell(state)?.tableFrom).toBe(FILLER.length + 2);
    });

    it('drops the active decoration while the index is incomplete, then rebuilds on recovery', () => {
        let state = createMarkdownState(TABLE, [activeCellField, tableDecorationField]);
        state = state.update({
            effects: setActiveCellEffect.of({ tableFrom: 0, section: 'body', row: 0, col: 0 }),
        }).state;
        expect(state.field(tableDecorationField).decorations.size).toBe(1);

        let now = 0;
        const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => {
            now += CLOCK_ADVANCE_MS;
            return now;
        });
        try {
            state = state.update({ changes: { from: state.doc.length, insert: `\n\n${LONG_TABLE_DOCUMENT}` } }).state;
        } finally {
            dateNow.mockRestore();
        }

        expect(state.field(tableContextField).treeIncomplete).toBe(true);
        expect(state.field(tableDecorationField).decorations.size).toBe(0);
        expect(isTableRenderingActive(state)).toBe(false);
        expect(wasActiveHostInvalidated(state)).toBe(true);

        state = state.update({ effects: clearActiveCellEffect.of(undefined) }).state;
        expect(state.field(tableDecorationField).decorations.size).toBe(0);
        expect(isTableRenderingActive(state)).toBe(false);

        expect(ensureSyntaxTree(state, state.doc.length, COMPLETE_PARSE_TIMEOUT_MS)).not.toBeNull();
        state = state.update({}).state;

        expect(state.field(tableContextField).treeIncomplete).toBe(false);
        expect(state.field(tableDecorationField).decorations.size).toBe(TABLE_COUNT + 1);
        expect(isTableRenderingActive(state)).toBe(true);
    });

    it('reports rendering inactive when the decoration field is absent', () => {
        expect(isTableRenderingActive(createMarkdownState(TABLE))).toBe(false);
    });

    it('keeps decorations dropped after a full replace until the deferred rebuild arrives', () => {
        const base = createMarkdownState(TABLE, [activeCellField, tableDecorationField]);
        const active = base.update({
            effects: setActiveCellEffect.of({ tableFrom: 0, section: 'header', row: 0, col: 0 }),
        }).state;
        expect(active.field(tableDecorationField).decorations.size).toBe(1);

        // A full replace while a cell is active drops the widgets; the lifecycle rebuilds them
        // on the next animation frame, once the stale active cell has been cleared.
        const replaced = active.update({ changes: { from: 0, to: active.doc.length, insert: TABLE } }).state;
        expect(replaced.field(tableDecorationField).decorations.size).toBe(0);
        expect(isTableRenderingActive(replaced)).toBe(false);

        const afterSelection = replaced.update({ selection: { anchor: 1 } }).state;
        expect(afterSelection.field(tableDecorationField).decorations.size).toBe(0);
        expect(isTableRenderingActive(afterSelection)).toBe(false);

        const rebuilt = afterSelection.update({ effects: rebuildAllTableWidgetsEffect.of(undefined) }).state;
        expect(rebuilt.field(tableDecorationField).decorations.size).toBe(1);
        expect(isTableRenderingActive(rebuilt)).toBe(true);
    });

    it('preserves the active decoration while rebuilding another edited table', () => {
        const doc = `${TABLE}\n\n${TABLE.replace('a', 'c')}`;
        let state = createMarkdownState(doc, [activeCellField, tableDecorationField]);
        state = state.update({
            effects: setActiveCellEffect.of({ tableFrom: 0, section: 'body', row: 0, col: 0 }),
        }).state;
        const activeBefore = getDecorationAt(state, 0, TABLE.length);
        const secondTableFrom = TABLE.length + 2;
        const secondCell = state.doc.toString().indexOf('c', secondTableFrom);

        state = state.update({ changes: { from: secondCell, to: secondCell + 1, insert: 'changed' } }).state;

        expect(getDecorationAt(state, 0, TABLE.length)).toBe(activeBefore);
        expect(wasActiveHostInvalidated(state)).toBe(false);
        expect(state.field(tableContextField).tables[1].text).toContain('changed');
    });

    it('does not preserve the active decoration for an outside-table undo', () => {
        const doc = `before\n\n${TABLE}`;
        const tableFrom = 'before\n\n'.length;
        let state = createMarkdownState(doc, [activeCellField, tableDecorationField]);
        state = state.update({
            effects: setActiveCellEffect.of({ tableFrom, section: 'body', row: 0, col: 0 }),
        }).state;
        const before = getDecorationAt(state, tableFrom, state.doc.length);

        state = state.update({
            changes: { from: 0, to: 6, insert: 'earlier' },
            annotations: Transaction.userEvent.of('undo'),
        }).state;
        const mappedTableFrom = 'earlier\n\n'.length;

        expect(getDecorationAt(state, mappedTableFrom, state.doc.length)).not.toBe(before);
        expect(wasActiveHostInvalidated(state)).toBe(true);
    });

    it.each([
        ['an invalid cell', [setActiveCellEffect.of({ tableFrom: 0, section: 'body' as const, row: 0, col: 2 })]],
        ['a clear', [clearActiveCellEffect.of(undefined)]],
        ['an explicit rebuild', [rebuildAllTableWidgetsEffect.of(undefined)]],
        [
            'a clear followed by the same activation',
            [
                clearActiveCellEffect.of(undefined),
                setActiveCellEffect.of({ tableFrom: 0, section: 'body' as const, row: 0, col: 0 }),
            ],
        ],
    ])('ends active-host preservation for %s', (_name, effects) => {
        let state = createMarkdownState(TABLE, [activeCellField, tableDecorationField]);
        state = state.update({
            effects: setActiveCellEffect.of({ tableFrom: 0, section: 'body', row: 0, col: 0 }),
        }).state;
        const before = getDecorationAt(state, 0, TABLE.length);

        state = state.update({ effects }).state;

        expect(getDecorationAt(state, 0, TABLE.length)).not.toBe(before);
        expect(wasActiveHostInvalidated(state)).toBe(false);
    });

    it.each([
        ['the same cell', [setActiveCellEffect.of({ tableFrom: 0, section: 'body' as const, row: 0, col: 0 })]],
        ['a cell switch', [setActiveCellEffect.of({ tableFrom: 0, section: 'body' as const, row: 0, col: 1 })]],
        ['an open request', [triggerOpenCellRequestEffect.of({ requestId: 'test-request' })]],
    ])('preserves the active table for %s', (_name, effects) => {
        const activeCell = { tableFrom: 0, section: 'body' as const, row: 0, col: 0 };
        let state = createMarkdownState(TABLE, [activeCellField, tableDecorationField]);
        state = state.update({ effects: setActiveCellEffect.of(activeCell) }).state;
        const before = getDecorationAt(state, 0, TABLE.length);

        state = state.update({ effects }).state;

        expect(getDecorationAt(state, 0, TABLE.length)).toBe(before);
    });

    it('ends preservation when activation moves to another table', () => {
        const secondTableFrom = TABLE.length + 2;
        let state = createMarkdownState(`${TABLE}\n\n${TABLE}`, [activeCellField, tableDecorationField]);
        state = state.update({
            effects: setActiveCellEffect.of({ tableFrom: 0, section: 'body', row: 0, col: 0 }),
        }).state;
        const before = getDecorationAt(state, 0, TABLE.length);

        state = state.update({
            effects: setActiveCellEffect.of({ tableFrom: secondTableFrom, section: 'body', row: 0, col: 0 }),
        }).state;

        expect(getDecorationAt(state, 0, TABLE.length)).not.toBe(before);
    });

    it('rejects preservation when an in-cell edit changes the syntax shape', () => {
        let state = createMarkdownState(TABLE, [activeCellField, tableDecorationField]);
        state = state.update({
            effects: setActiveCellEffect.of({ tableFrom: 0, section: 'body', row: 0, col: 0 }),
        }).state;
        const resolved = getResolvedActiveCell(state);
        if (!resolved) throw new Error('Expected active cell to resolve');

        state = state.update({
            changes: { from: resolved.editableFrom, insert: 'x | ' },
            annotations: Transaction.userEvent.of('undo'),
        }).state;

        expect(wasActiveHostInvalidated(state)).toBe(true);
    });

    it('preserves the active host for an in-cell undo', () => {
        let state = createMarkdownState(TABLE, [activeCellField, tableDecorationField]);
        state = state.update({
            effects: setActiveCellEffect.of({ tableFrom: 0, section: 'body', row: 0, col: 0 }),
        }).state;
        const resolved = getResolvedActiveCell(state);
        if (!resolved) throw new Error('Expected active cell to resolve');
        const before = getDecorationAt(state, 0, TABLE.length);

        state = state.update({
            changes: { from: resolved.editableFrom, to: resolved.editableTo, insert: 'changed' },
            annotations: Transaction.userEvent.of('undo'),
        }).state;

        expect(getDecorationAt(state, 0, state.doc.length)).toBe(before);
        expect(wasActiveHostInvalidated(state)).toBe(false);
    });

    it('does not report host invalidation when no cell was active', () => {
        const state = createMarkdownState(TABLE, [activeCellField, tableDecorationField]).update({
            changes: { from: TABLE.indexOf('a'), to: TABLE.indexOf('a') + 1, insert: 'changed' },
        }).state;

        expect(wasActiveHostInvalidated(state)).toBe(false);
    });

    it('rejects preservation when an outside edit removes root-table membership', () => {
        const prefix = 'before\n\n';
        let state = createMarkdownState(`${prefix}${TABLE}`, [activeCellField, tableDecorationField]);
        state = state.update({
            effects: setActiveCellEffect.of({ tableFrom: prefix.length, section: 'body', row: 0, col: 0 }),
        }).state;

        state = state.update({ changes: { from: 0, insert: '~~~\n' } }).state;

        expect(state.field(tableContextField).tables).toHaveLength(0);
        expect(wasActiveHostInvalidated(state)).toBe(true);
    });
});

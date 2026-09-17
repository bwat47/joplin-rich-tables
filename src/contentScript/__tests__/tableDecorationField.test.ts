import { ensureSyntaxTree } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState, StateEffect } from '@codemirror/state';
import { GFM } from '@lezer/markdown';
import { describe, expect, it, vi } from 'vitest';
import { isTableRenderingActive, tableDecorationField } from '../tableWidget/tableDecorationField';
import { tableContextField } from '../tableState/tableContextField';
import { activeCellField, setActiveCellEffect } from '../tableState/activeCellState';
import { rebuildAllTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { getResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { createMarkdownState } from './testMarkdownState';

const TABLE_COUNT = 5;
const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');
const FILLER = 'lorem ipsum dolor sit amet '.repeat(40);
const LONG_TABLE_DOCUMENT = Array.from({ length: TABLE_COUNT }, () => `${FILLER}\n\n${TABLE}`).join('\n\n');
const CLOCK_ADVANCE_MS = 2_000;
const COMPLETE_PARSE_TIMEOUT_MS = 1_000;

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

    it('maps existing decorations while an updated index is incomplete, then rebuilds on recovery', () => {
        let state = createMarkdownState(TABLE, [tableDecorationField]);
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
        expect(state.field(tableDecorationField).decorations.size).toBe(1);
        expect(isTableRenderingActive(state)).toBe(true);

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
});

import { describe, expect, it } from 'vitest';
import { activeCellField, getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { createResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import {
    beginOpenCellRequestEffect,
    openCellRequestField,
    prepareOpenCellRequestTransaction,
    triggerOpenCellRequestEffect,
    type CellEntryMode,
} from '../tableRuntime/openCellRequest';
import { normalizeBeforeEditAnnotation } from '../tableRuntime/tableCanonicalForm';
import { resolveTableContextAtPos } from '../tableRuntime/tableResolution';
import { createMarkdownState } from './testMarkdownState';

const canonicalTable = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
const nonCanonicalTable = ['|H1|H2|', '|---|---|', '|a1|a2|'].join('\n');

const REQUEST_ID = 'test-open-request';

function headerCellAt(tableFrom: number): ActiveCell {
    return { tableFrom, section: 'header', row: 0, col: 0 };
}

/**
 * Builds a document containing a table at `tableFrom` and prepares the transaction that
 * enters `activeCell`, the way every keyboard, click and navigation entry point does.
 */
function enterCell(params: { doc: string; tableFrom: number; activeCell?: ActiveCell; entryMode?: CellEntryMode }) {
    const activeCell = params.activeCell ?? headerCellAt(params.tableFrom);
    const state = createMarkdownState(params.doc, [activeCellField, openCellRequestField]).update({
        effects: setActiveCellEffect.of(activeCell),
    }).state;

    const ctx = resolveTableContextAtPos(state, params.tableFrom);
    if (!ctx) {
        throw new Error('Expected a table at tableFrom');
    }
    const resolvedCell = createResolvedActiveCell({ ctx, coords: activeCell });
    if (!resolvedCell) {
        throw new Error('Expected the cell to resolve');
    }

    const spec = prepareOpenCellRequestTransaction({
        state,
        resolvedCell,
        entryMode: params.entryMode,
        requestId: REQUEST_ID,
        initialCursorPos: 'end',
    });

    return { state, spec, transaction: state.update(spec) };
}

describe('entering a cell', () => {
    it('leaves the document alone when the table is already canonical and spaced', () => {
        const doc = `\n${canonicalTable}\n`;
        const { transaction } = enterCell({ doc, tableFrom: 1 });

        expect(transaction.docChanged).toBe(false);
        expect(transaction.state.doc.toString()).toBe(doc);
    });

    it('leaves the document alone when the entry may not repair', () => {
        const { transaction } = enterCell({
            doc: nonCanonicalTable,
            tableFrom: 0,
            entryMode: 'enter',
        });

        expect(transaction.docChanged).toBe(false);
        expect(transaction.state.doc.toString()).toBe(nonCanonicalTable);
    });

    it('rewrites the table and remaps the active cell in the transaction that opens it', () => {
        const { transaction } = enterCell({
            doc: nonCanonicalTable,
            tableFrom: 0,
            activeCell: { tableFrom: 0, section: 'body', row: 0, col: 1 },
        });

        expect(transaction.state.doc.toString()).toBe(`\n${canonicalTable}\n`);
        expect(getActiveCell(transaction.state)).toEqual({
            tableFrom: 1,
            section: 'body',
            row: 0,
            col: 1,
        });
        expect(transaction.state.selection.main.anchor).toBeGreaterThan(0);
        expect(transaction.annotation(normalizeBeforeEditAnnotation)).toBe(true);
        expect(transaction.effects.some((effect) => effect.is(rebuildTableWidgetsEffect))).toBe(true);
    });

    it('opens the request that the repair landed on', () => {
        const { transaction } = enterCell({ doc: nonCanonicalTable, tableFrom: 0 });

        expect(
            transaction.effects.some(
                (effect) =>
                    effect.is(beginOpenCellRequestEffect) &&
                    effect.value.requestId === REQUEST_ID &&
                    effect.value.activeCell.tableFrom === 1 &&
                    effect.value.initialCursorPos === 'end'
            )
        ).toBe(true);
        expect(
            transaction.effects.some(
                (effect) => effect.is(triggerOpenCellRequestEffect) && effect.value.requestId === REQUEST_ID
            )
        ).toBe(true);
    });

    describe('boundary spacing', () => {
        it('adds a blank line above a table that follows text directly', () => {
            const doc = `intro\n${canonicalTable}\n\nafter`;
            const { transaction } = enterCell({ doc, tableFrom: 'intro\n'.length });

            expect(transaction.state.doc.toString()).toBe(`intro\n\n${canonicalTable}\n\nafter`);
            expect(getActiveCell(transaction.state)?.tableFrom).toBe('intro\n\n'.length);
        });

        it('normalizes pipe-free text directly below a table as a row', () => {
            const tableFrom = 'intro\n\n'.length;
            const doc = `intro\n\n${canonicalTable}\nafter`;
            const { transaction } = enterCell({ doc, tableFrom });

            expect(transaction.state.doc.toString()).toBe(`intro\n\n${canonicalTable}\n| after |  |\n`);
            expect(getActiveCell(transaction.state)?.tableFrom).toBe(tableFrom);
        });

        it('separates text above while normalizing pipe-free text below as a row', () => {
            const doc = `intro\n${canonicalTable}\nafter`;
            const { transaction } = enterCell({ doc, tableFrom: 'intro\n'.length });

            expect(transaction.state.doc.toString()).toBe(`intro\n\n${canonicalTable}\n| after |  |\n`);
        });

        it('leaves an already separated mid-document table alone', () => {
            const doc = `intro\n\n${canonicalTable}\n\nafter`;
            const { transaction } = enterCell({ doc, tableFrom: 'intro\n\n'.length });

            expect(transaction.docChanged).toBe(false);
        });

        it('treats the document edges as unseparated boundaries', () => {
            // Intended: a table flush against the document start is padded so there is
            // always a newline before it, and the same applies at the document end.
            const { transaction } = enterCell({ doc: canonicalTable, tableFrom: 0 });

            expect(transaction.state.doc.toString()).toBe(`\n${canonicalTable}\n`);
        });

        it('normalizes markdown and boundaries in a single replacement', () => {
            const doc = `intro\n${nonCanonicalTable}\nafter`;
            const { transaction } = enterCell({ doc, tableFrom: 'intro\n'.length });

            let changeCount = 0;
            transaction.changes.iterChanges(() => {
                changeCount++;
            });

            expect(transaction.state.doc.toString()).toBe(`intro\n\n${canonicalTable}\n| after |  |\n`);
            expect(changeCount).toBe(1);
        });
    });
});

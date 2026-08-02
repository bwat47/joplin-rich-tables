import { describe, expect, it } from 'vitest';
import type { EditorState } from '@codemirror/state';
import { activeCellField, getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { resolveActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import {
    beginOpenCellRequestEffect,
    openCellRequestField,
    triggerOpenCellRequestEffect,
    type OpenCellRequest,
} from '../tableRuntime/openCellRequest';
import {
    normalizeBeforeEditAnnotation,
    planNormalizeTableBeforeOpen,
    type NormalizeTableBeforeOpenPlan,
} from '../tableRuntime/lifecycle/tableNormalization';
import { createMarkdownState } from './testMarkdownState';

const canonicalTable = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
const nonCanonicalTable = ['|H1|H2|', '|---|---|', '|a1|a2|'].join('\n');

function createOpenRequest(params: { activeCell: ActiveCell; normalizeIfNeeded: boolean }): OpenCellRequest {
    return {
        requestId: 'test-open-request',
        activeCell: params.activeCell,
        normalizeIfNeeded: params.normalizeIfNeeded,
        initialCursorPos: 'end',
        suppressKeys: false,
    };
}

function addPendingOpenRequest(state: EditorState, request: OpenCellRequest): EditorState {
    return state.update({ effects: beginOpenCellRequestEffect.of(request) }).state;
}

function requireResolvedActiveCell(state: EditorState) {
    const resolved = resolveActiveCell(state, getActiveCell(state));
    if (!resolved) {
        throw new Error('Expected resolved active cell');
    }
    return resolved;
}

function headerCellAt(tableFrom: number): ActiveCell {
    return {
        tableFrom,
        section: 'header',
        row: 0,
        col: 0,
    };
}

/**
 * Builds a document containing `table` at `tableFrom`, points the active cell at it,
 * registers a pending open request, and plans normalization for that request.
 */
function planFor(params: {
    doc: string;
    tableFrom: number;
    activeCell?: ActiveCell;
    normalizeIfNeeded?: boolean;
    registerRequest?: boolean;
}): { state: EditorState; plan: NormalizeTableBeforeOpenPlan } {
    const activeCell = params.activeCell ?? headerCellAt(params.tableFrom);
    let state = createMarkdownState(params.doc, [activeCellField, openCellRequestField]);
    state = state.update({ effects: setActiveCellEffect.of(activeCell) }).state;

    const request = createOpenRequest({ activeCell, normalizeIfNeeded: params.normalizeIfNeeded ?? true });
    if (params.registerRequest ?? true) {
        state = addPendingOpenRequest(state, request);
    }

    return {
        state,
        plan: planNormalizeTableBeforeOpen({
            state,
            resolvedActiveCell: requireResolvedActiveCell(state),
            request,
        }),
    };
}

function requireDispatchPlan(plan: NormalizeTableBeforeOpenPlan) {
    if (plan.type !== 'dispatch') {
        throw new Error(`Expected normalization dispatch plan, got ${plan.type}`);
    }
    return plan;
}

describe('planNormalizeTableBeforeOpen', () => {
    it('aborts when the open request is no longer pending', () => {
        const { plan } = planFor({
            doc: nonCanonicalTable,
            tableFrom: 0,
            registerRequest: false,
        });

        expect(plan).toEqual({ type: 'aborted' });
    });

    it('skips normalization when the request opted out', () => {
        const { plan } = planFor({
            doc: nonCanonicalTable,
            tableFrom: 0,
            normalizeIfNeeded: false,
        });

        expect(plan).toEqual({ type: 'not-needed' });
    });

    it('skips normalization when the table is already canonical and spaced', () => {
        const { plan } = planFor({
            doc: `\n${canonicalTable}\n`,
            tableFrom: 1,
        });

        expect(plan).toEqual({ type: 'not-needed' });
    });

    it('remaps the active cell and retriggers the open request when it normalizes', () => {
        const activeCell: ActiveCell = {
            tableFrom: 0,
            section: 'body',
            row: 0,
            col: 1,
        };
        const { state, plan } = planFor({
            doc: nonCanonicalTable,
            tableFrom: 0,
            activeCell,
        });

        const tr = state.update(requireDispatchPlan(plan).spec);
        expect(tr.state.doc.toString()).toBe(`\n${canonicalTable}\n`);
        expect(getActiveCell(tr.state)).toEqual({
            tableFrom: 1,
            section: 'body',
            row: 0,
            col: 1,
        });
        expect(tr.state.selection.main.anchor).toBeGreaterThan(0);
        expect(tr.annotation(normalizeBeforeEditAnnotation)).toBe(true);
        expect(tr.effects.some((effect) => effect.is(rebuildTableWidgetsEffect))).toBe(true);
        expect(
            tr.effects.some(
                (effect) =>
                    effect.is(beginOpenCellRequestEffect) &&
                    effect.value.requestId === 'test-open-request' &&
                    effect.value.normalizeIfNeeded === false &&
                    effect.value.activeCell.tableFrom === 1
            )
        ).toBe(true);
        expect(
            tr.effects.some(
                (effect) => effect.is(triggerOpenCellRequestEffect) && effect.value.requestId === 'test-open-request'
            )
        ).toBe(true);
    });

    describe('boundary spacing', () => {
        it('adds a blank line above a table that follows text directly', () => {
            const doc = `intro\n${canonicalTable}\n\nafter`;
            const { state, plan } = planFor({ doc, tableFrom: 'intro\n'.length });

            const tr = state.update(requireDispatchPlan(plan).spec);
            expect(tr.state.doc.toString()).toBe(`intro\n\n${canonicalTable}\n\nafter`);
            expect(getActiveCell(tr.state)?.tableFrom).toBe('intro\n\n'.length);
        });

        it('adds a blank line below a table that precedes text directly', () => {
            const doc = `intro\n\n${canonicalTable}\nafter`;
            const tableFrom = 'intro\n\n'.length;
            const { state, plan } = planFor({ doc, tableFrom });

            const tr = state.update(requireDispatchPlan(plan).spec);
            expect(tr.state.doc.toString()).toBe(`intro\n\n${canonicalTable}\n\nafter`);
            // Padding is appended, so the table start is unchanged.
            expect(getActiveCell(tr.state)?.tableFrom).toBe(tableFrom);
        });

        it('adds blank lines on both sides when neither boundary is separated', () => {
            const doc = `intro\n${canonicalTable}\nafter`;
            const { state, plan } = planFor({ doc, tableFrom: 'intro\n'.length });

            const tr = state.update(requireDispatchPlan(plan).spec);
            expect(tr.state.doc.toString()).toBe(`intro\n\n${canonicalTable}\n\nafter`);
        });

        it('leaves an already separated mid-document table alone', () => {
            const doc = `intro\n\n${canonicalTable}\n\nafter`;
            const { plan } = planFor({ doc, tableFrom: 'intro\n\n'.length });

            expect(plan).toEqual({ type: 'not-needed' });
        });

        it('treats the document edges as unseparated boundaries', () => {
            // Intended: a table flush against the document start is padded so there is
            // always a newline before it, and the same applies at the document end.
            const { state, plan } = planFor({ doc: canonicalTable, tableFrom: 0 });

            const tr = state.update(requireDispatchPlan(plan).spec);
            expect(tr.state.doc.toString()).toBe(`\n${canonicalTable}\n`);
        });

        it('normalizes markdown and boundaries in a single replacement', () => {
            const doc = `intro\n${nonCanonicalTable}\nafter`;
            const { state, plan } = planFor({ doc, tableFrom: 'intro\n'.length });

            const tr = state.update(requireDispatchPlan(plan).spec);
            expect(tr.state.doc.toString()).toBe(`intro\n\n${canonicalTable}\n\nafter`);
            expect(tr.state.doc.toString().startsWith('intro\n\n')).toBe(true);
        });
    });
});

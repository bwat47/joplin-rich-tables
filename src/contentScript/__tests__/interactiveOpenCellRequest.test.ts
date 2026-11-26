import type { TransactionSpec } from '@codemirror/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activateCellAtPosition } from '../tableRuntime/cellActivation';
import { navigateCell } from '../tableRuntime/navigation/tableNavigation';
import { getActiveCell } from '../tableState/activeCellState';
import { getPendingOpenCellRequest, openCellRequestEffect } from '../tableState/openCellRequestState';
import {
    createInteractiveTableHarness,
    getLastDispatchSpec,
    NON_CANONICAL_DOC,
    type MutableTestView,
} from './interactiveTableTestHarness';
import { createEditorViewHarness, createResizeObserverStub, mountTableWidgetView } from './tableEditorFixtures';
import { getDispatchedEffects } from './testUtils';

/** What {@link NON_CANONICAL_DOC} becomes once entry repairs it, document padding included. */
const NORMALIZED_DOC = `\n${['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n')}\n`;

const resizeObserver = createResizeObserverStub();
const viewHarness = createEditorViewHarness();

beforeEach(() => {
    resizeObserver.install();
});

afterEach(() => {
    viewHarness.destroyViews();
    vi.restoreAllMocks();
});

function findOpenRequest(spec: TransactionSpec) {
    return (
        getDispatchedEffects(spec).find((effect): effect is ReturnType<typeof openCellRequestEffect.of> =>
            effect.is(openCellRequestEffect)
        ) ?? null
    );
}

describe('interactive open-cell requests', () => {
    it('normalizes the table in the transaction a mousedown activation opens it with', () => {
        const { view, cells } = mountTableWidgetView(viewHarness, { doc: NON_CANONICAL_DOC });
        const dispatch = vi.spyOn(view, 'dispatch');

        const event = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0,
        });
        cells.header0.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(view.state.doc.toString()).toBe(NORMALIZED_DOC);
        expect(getActiveCell(view.state)).toMatchObject({
            section: 'header',
            row: 0,
            col: 0,
        });

        // The repair and the open request travel together, so no intermediate state shows the
        // table normalized without the cell opened.
        const changingSpecs = dispatch.mock.calls
            .map(([spec]) => spec as TransactionSpec)
            .filter((spec) => spec.changes !== undefined);
        expect(changingSpecs).toHaveLength(1);
        expect(findOpenRequest(changingSpecs[0]!)).not.toBeNull();
    });

    it('normalizes the table in the transaction a cursor activation opens it with', () => {
        const { view } = createInteractiveTableHarness();

        expect(activateCellAtPosition(view, NON_CANONICAL_DOC.indexOf('H1'))).toBe(true);
        expect(view.state.doc.toString()).toBe(NORMALIZED_DOC);
        expect(getActiveCell(view.state)).toMatchObject({
            section: 'header',
            row: 0,
            col: 0,
        });

        expect(findOpenRequest(getLastDispatchSpec(view as unknown as MutableTestView))).not.toBeNull();
    });

    it('can enter without repairing on cursor activation for lifecycle-driven re-entry', () => {
        const { view } = createInteractiveTableHarness();

        expect(activateCellAtPosition(view, NON_CANONICAL_DOC.indexOf('H1'), { entryMode: 'enter' })).toBe(true);
        expect(view.state.doc.toString()).toBe(NON_CANONICAL_DOC);
        expect(findOpenRequest(getLastDispatchSpec(view as unknown as MutableTestView))).not.toBeNull();
    });

    it('clamps a preferred fallback cell instead of reopening the first cell on structural punctuation', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const { view } = createInteractiveTableHarness({ doc });

        expect(
            activateCellAtPosition(view, doc.indexOf('| a2'), {
                entryMode: 'enter',
                preferredActiveCell: {
                    tableFrom: 0,
                    section: 'body',
                    row: 1,
                    col: 1,
                },
            })
        ).toBe(true);

        expect(getActiveCell(view.state)).toMatchObject({
            section: 'body',
            row: 0,
            col: 1,
        });
    });

    it('normalizes the table in the transaction keyboard navigation reopens a cell with', () => {
        const { view } = createInteractiveTableHarness({
            activeCell: {
                tableFrom: 0,
                section: 'header',
                row: 0,
                col: 0,
            },
        });

        expect(navigateCell(view, 'next', { initialCursorPos: 'end' })).toBe(true);
        expect(view.state.doc.toString()).toBe(NORMALIZED_DOC);

        const activeCell = getActiveCell(view.state);
        expect(activeCell).toMatchObject({
            section: 'header',
            row: 0,
            col: 1,
        });

        expect(findOpenRequest(getLastDispatchSpec(view as unknown as MutableTestView))).not.toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toMatchObject({
            activeCell,
            initialCursorPos: 'end',
        });
    });
});

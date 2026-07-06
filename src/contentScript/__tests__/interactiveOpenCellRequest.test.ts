import { describe, expect, it, vi } from 'vitest';
import { type TransactionSpec } from '@codemirror/state';
import { activateCellAtPosition } from '../tableRuntime/activeCell/cellActivation';
import { getActiveCell } from '../tableState/activeCellState';
import { handleTableInteraction } from '../tableWidget/tableWidgetInteractions';
import { navigateCell } from '../tableRuntime/navigation/tableNavigation';
import {
    beginOpenCellRequestEffect,
    getPendingOpenCellRequest,
    triggerOpenCellRequestEffect,
} from '../tableRuntime/openCellRequest';
import {
    createInteractiveTableHarness,
    getLastDispatchSpec,
    type MutableTestView,
    NON_CANONICAL_DOC,
} from './interactiveTableTestHarness';

function findOpenRequest(spec: TransactionSpec) {
    const effects = Array.isArray(spec.effects) ? spec.effects : [spec.effects];
    return effects.find((effect) => effect?.is?.(triggerOpenCellRequestEffect)) ?? null;
}

function findBeginOpenRequest(spec: TransactionSpec) {
    const effects = Array.isArray(spec.effects) ? spec.effects : [spec.effects];
    return effects.find((effect) => effect?.is?.(beginOpenCellRequestEffect)) ?? null;
}

describe('interactive open-cell requests', () => {
    it('requests normalization on mousedown cell activation before opening the nested editor', () => {
        const { view, cells } = createInteractiveTableHarness();
        const event = {
            type: 'mousedown',
            button: 0,
            target: cells.header0,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as unknown as MouseEvent;

        expect(handleTableInteraction(view, event)).toBe(true);
        expect(view.state.doc.toString()).toBe(NON_CANONICAL_DOC);
        expect(getActiveCell(view.state)).toMatchObject({
            section: 'header',
            row: 0,
            col: 0,
        });

        const beginRequest = findBeginOpenRequest(getLastDispatchSpec(view as unknown as MutableTestView));
        expect(beginRequest?.value).toMatchObject({ normalizeIfNeeded: true });
        expect(findOpenRequest(getLastDispatchSpec(view as unknown as MutableTestView))).not.toBeNull();
    });

    it('requests normalization on cursor activation before opening the nested editor', () => {
        const { view } = createInteractiveTableHarness();

        expect(activateCellAtPosition(view, NON_CANONICAL_DOC.indexOf('H1'))).toBe(true);
        expect(view.state.doc.toString()).toBe(NON_CANONICAL_DOC);
        expect(getActiveCell(view.state)).toMatchObject({
            section: 'header',
            row: 0,
            col: 0,
        });

        const beginRequest = findBeginOpenRequest(getLastDispatchSpec(view as unknown as MutableTestView));
        expect(beginRequest?.value).toMatchObject({ normalizeIfNeeded: true });
        expect(findOpenRequest(getLastDispatchSpec(view as unknown as MutableTestView))).not.toBeNull();
    });

    it('can skip normalization on cursor activation for lifecycle-driven re-entry', () => {
        const { view } = createInteractiveTableHarness();

        expect(activateCellAtPosition(view, NON_CANONICAL_DOC.indexOf('H1'), { normalizeIfNeeded: false })).toBe(true);
        expect(view.state.doc.toString()).toBe(NON_CANONICAL_DOC);
        const openRequest = findOpenRequest(getLastDispatchSpec(view as unknown as MutableTestView));
        const beginRequest = findBeginOpenRequest(getLastDispatchSpec(view as unknown as MutableTestView));
        expect(beginRequest?.value).toMatchObject({ normalizeIfNeeded: false });
        expect(openRequest?.value).toEqual({ requestId: beginRequest?.value?.requestId });
    });

    it('clamps a preferred fallback cell instead of reopening the first cell on structural punctuation', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const { view } = createInteractiveTableHarness({ doc });

        expect(
            activateCellAtPosition(view, doc.indexOf('| a2'), {
                normalizeIfNeeded: false,
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

    it('requests normalization on keyboard navigation before reopening the target cell', () => {
        const { view } = createInteractiveTableHarness({
            activeCell: {
                tableFrom: 0,
                section: 'header',
                row: 0,
                col: 0,
            },
        });

        expect(navigateCell(view, 'next', { cursorPos: 'end' })).toBe(true);
        expect(view.state.doc.toString()).toBe(NON_CANONICAL_DOC);

        const activeCell = getActiveCell(view.state);
        expect(activeCell).toMatchObject({
            section: 'header',
            row: 0,
            col: 1,
        });

        const beginRequest = findBeginOpenRequest(getLastDispatchSpec(view as unknown as MutableTestView));
        expect(beginRequest?.value).toMatchObject({ normalizeIfNeeded: true });
        expect(findOpenRequest(getLastDispatchSpec(view as unknown as MutableTestView))).not.toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toMatchObject({
            activeCell,
            initialCursorPos: 'end',
        });
    });
});

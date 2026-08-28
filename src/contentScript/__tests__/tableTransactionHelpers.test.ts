import { describe, expect, it, vi } from 'vitest';
import type { ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import type { ActiveCell } from '../tableState/activeCellState';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { computeMarkdownTableCellRanges } from '../tableModel/markdownTableCellRanges';
import { runStructuralMutationAndReopen } from '../tableRuntime/operations/runStructuralMutation';
import { clearActiveCellEffect, setActiveCellEffect } from '../tableState/activeCellState';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { triggerOpenCellRequestEffect } from '../tableRuntime/openCellRequest';
import { createActiveCellForTableText } from '../tableRuntime/activeCell/activeCellFactory';
import { beginOpenCellRequestEffect } from '../tableRuntime/openCellRequest';

describe('tableTransactionHelpers', () => {
    let currentTableText = '';

    function createView(tableText: string) {
        currentTableText = tableText;
        const dispatch = vi.fn();
        return {
            state: {
                doc: { length: tableText.length },
            },
            dispatch,
        };
    }

    function createCell(tableText: string, row = 0, col = 0) {
        return {
            tableFrom: 0,
            section: 'body' as const,
            row,
            col,
        } satisfies ActiveCell;
    }

    function createResolvedCell(cell: ActiveCell): ResolvedActiveCell {
        const table = MarkdownTable.parse(currentTableText);
        const cellRanges = computeMarkdownTableCellRanges(currentTableText);
        if (!table || !cellRanges) {
            throw new Error('Expected valid table fixture');
        }

        return {
            activeCell: cell,
            tableFrom: 0,
            tableTo: currentTableText.length,
            contentFrom: 0,
            contentTo: 0,
            editableFrom: 0,
            editableTo: 0,
            ctx: {
                from: 0,
                to: currentTableText.length,
                text: currentTableText,
                table,
                cellRanges,
            },
        };
    }

    it('dispatches an explicit reopen transaction for row insertion', () => {
        const tableText = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');
        const insertedTableText = ['| H1 | H2 |', '| --- | --- |', '| a | b |', '|  |  |'].join('\n');
        const nextActiveCell = createActiveCellForTableText({
            tableFrom: 0,
            tableText: insertedTableText,
            target: { section: 'body', row: 1, col: 1 },
        });
        expect(nextActiveCell).not.toBeNull();
        if (!nextActiveCell) {
            throw new Error('Expected inserted row active cell');
        }
        const view = createView(tableText);
        const cell = createCell(tableText, 0, 1);
        const afterDispatch = vi.fn();

        const result = runStructuralMutationAndReopen({
            view: view as never,
            resolvedCell: createResolvedCell(cell),
            command: { type: 'insertRowAfter' },
            initialCursorPos: 'start',
            afterDispatch,
        });

        expect(result).toBe(true);
        expect(view.dispatch).toHaveBeenCalledTimes(1);
        expect(afterDispatch).toHaveBeenCalledTimes(1);

        const dispatched = view.dispatch.mock.calls[0][0] as {
            changes?: unknown;
            selection?: { anchor: number };
            effects: Array<{ is?: (value: unknown) => boolean; value?: unknown }>;
        };
        expect(dispatched.changes).toEqual({
            from: 0,
            to: tableText.length,
            insert: insertedTableText,
        });
        expect(dispatched.selection).toEqual({ anchor: nextActiveCell.selectionAnchor });

        const effects = dispatched.effects;
        expect(effects.some((effect: { is?: (value: unknown) => boolean }) => effect.is?.(setActiveCellEffect))).toBe(
            true
        );
        expect(
            effects.some((effect: { is?: (value: unknown) => boolean }) => effect.is?.(rebuildTableWidgetsEffect))
        ).toBe(true);
        const openRequest = effects.find((effect: { is?: (value: unknown) => boolean }) =>
            effect.is?.(triggerOpenCellRequestEffect)
        );
        const beginRequest = effects.find((effect: { is?: (value: unknown) => boolean }) =>
            effect.is?.(beginOpenCellRequestEffect)
        );
        expect(beginRequest?.value).toMatchObject({
            activeCell: { section: 'body', row: 1, col: 1 },
        });
        expect(openRequest?.value).toEqual({ requestId: (beginRequest?.value as { requestId?: string })?.requestId });
    });

    it('does not run the post-dispatch callback when the structural command is a no-op', () => {
        const tableText = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');
        const view = createView(tableText);
        const cell = createCell(tableText, 0, 0);
        const afterDispatch = vi.fn();

        const result = runStructuralMutationAndReopen({
            view: view as never,
            resolvedCell: createResolvedCell(cell),
            command: { type: 'moveColumnLeft' },
            afterDispatch,
        });

        expect(result).toBe(false);
        expect(view.dispatch).not.toHaveBeenCalled();
        expect(afterDispatch).not.toHaveBeenCalled();
    });

    it('dispatches reopen effects when markdown is unchanged but target cell moves', () => {
        const tableText = ['| H1 | H2 |', '| --- | --- |', '| a | a |', '| a | a |'].join('\n');
        const view = createView(tableText);
        const cell = createCell(tableText, 1, 0);

        const result = runStructuralMutationAndReopen({
            view: view as never,
            resolvedCell: createResolvedCell(cell),
            command: { type: 'moveRowUp' },
        });

        expect(result).toBe(true);
        expect(view.dispatch).toHaveBeenCalledTimes(1);

        const dispatched = view.dispatch.mock.calls[0][0] as {
            changes?: unknown;
            selection?: { anchor: number };
            effects: Array<{ is?: (value: unknown) => boolean; value?: unknown }>;
        };
        expect(dispatched.changes).toBeUndefined();
        expect(dispatched.selection).toEqual(expect.objectContaining({ anchor: expect.any(Number) }));

        const effects = dispatched.effects;
        expect(effects.some((effect) => effect.is?.(setActiveCellEffect))).toBe(true);
        expect(effects.some((effect) => effect.is?.(triggerOpenCellRequestEffect))).toBe(true);
        expect(effects.some((effect) => effect.is?.(rebuildTableWidgetsEffect))).toBe(true);
    });

    it('dispatches explicit reopen effects for non-row structural mutations too', () => {
        const tableText = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');
        const updatedTableText = ['| H1 | H2 |', '| :---: | --- |', '| a | b |'].join('\n');
        const nextActiveCell = createActiveCellForTableText({
            tableFrom: 0,
            tableText: updatedTableText,
            target: { section: 'body', row: 0, col: 0 },
        });
        expect(nextActiveCell).not.toBeNull();
        if (!nextActiveCell) {
            throw new Error('Expected aligned active cell');
        }

        const view = createView(tableText);
        const cell = createCell(tableText, 0, 0);

        const result = runStructuralMutationAndReopen({
            view: view as never,
            resolvedCell: createResolvedCell(cell),
            command: { type: 'alignColumn', alignment: 'center' },
        });

        expect(result).toBe(true);
        expect(view.dispatch).toHaveBeenCalledTimes(1);

        const dispatched = view.dispatch.mock.calls[0][0] as {
            changes?: { insert: string };
            effects: Array<{ is?: (value: unknown) => boolean; value?: unknown }>;
        };
        expect(dispatched.changes?.insert).toBe(updatedTableText);
        expect(dispatched.effects.some((effect) => effect.is?.(triggerOpenCellRequestEffect))).toBe(true);
        expect(dispatched.effects.some((effect) => effect.is?.(rebuildTableWidgetsEffect))).toBe(true);
    });

    it.each([
        ['deleteTable', '| H1 | H2 |\n| --- | --- |\n| a | b |', { section: 'body', row: 0, col: 0 }],
        ['deleteRow', '| H1 | H2 |\n| --- | --- |', { section: 'header', row: 0, col: 0 }],
        ['deleteColumn', '| H1 |\n| --- |\n| a |', { section: 'body', row: 0, col: 0 }],
    ] as const)('dispatches table deletion for %s without reopen effects', (commandType, tableText, activeCell) => {
        const view = createView(tableText);
        const afterDispatch = vi.fn();

        const result = runStructuralMutationAndReopen({
            view: view as never,
            resolvedCell: createResolvedCell({
                tableFrom: 0,
                ...activeCell,
            }),
            command: { type: commandType },
            afterDispatch,
        });

        expect(result).toBe(true);
        expect(view.dispatch).toHaveBeenCalledTimes(1);
        expect(afterDispatch).toHaveBeenCalledTimes(1);

        const dispatched = view.dispatch.mock.calls[0][0] as {
            changes?: unknown;
            selection?: unknown;
            effects: Array<{ is?: (value: unknown) => boolean }>;
        };
        expect(dispatched.changes).toEqual({
            from: 0,
            to: tableText.length,
            insert: '',
        });
        expect(dispatched.selection).toBeUndefined();
        expect(dispatched.effects.some((effect) => effect.is?.(clearActiveCellEffect))).toBe(true);
        expect(dispatched.effects.some((effect) => effect.is?.(rebuildTableWidgetsEffect))).toBe(true);
        expect(dispatched.effects.some((effect) => effect.is?.(triggerOpenCellRequestEffect))).toBe(false);
        expect(dispatched.effects.some((effect) => effect.is?.(beginOpenCellRequestEffect))).toBe(false);
    });
});

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { resolveActiveCell } from '../tableRuntime/activeCell/activeCellResolver';
import type { ActiveCell } from '../tableState/activeCellState';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { computeMarkdownTableCellRanges } from '../tableModel/markdownTableCellRanges';
import { runTableOperation, runTableOperationAndOpen } from '../tableRuntime/operations/runTableOperation';
import { setActiveCellEffect } from '../tableState/activeCellState';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { requestOpenActiveCellEffect } from '../tableRuntime/activeCell/activeCellOpen';
import { createActiveCellForTableText } from '../tableRuntime/activeCell/activeCellFactory';

jest.mock('../tableRuntime/activeCell/activeCellResolver', () => ({
    resolveActiveCell: jest.fn(),
}));

describe('tableTransactionHelpers', () => {
    let currentTableText = '';

    function createView(tableText: string) {
        currentTableText = tableText;
        const dispatch = jest.fn();
        return {
            state: {
                doc: { length: tableText.length },
            },
            dispatch,
        };
    }

    function createCell(tableText: string, row: number = 0, col: number = 0) {
        return {
            tableFrom: 0,
            section: 'body' as const,
            row,
            col,
        } satisfies ActiveCell;
    }

    beforeEach(() => {
        (resolveActiveCell as jest.Mock).mockImplementation((...args: unknown[]) => {
            const cell = args[1] as ActiveCell;

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
                    table: MarkdownTable.parse(currentTableText),
                    cellRanges: computeMarkdownTableCellRanges(currentTableText),
                },
            };
        });
    });

    it('dispatches an effect-only transaction when markdown is unchanged but target cell moves', () => {
        const tableText = ['| H1 | H2 |', '| --- | --- |', '| a | a |', '| a | a |'].join('\n');
        const view = createView(tableText);
        const cell = createCell(tableText, 1, 0);

        const result = runTableOperation({
            view: view as never,
            cell,
            operation: (table) => table.moveRow('body', 1, 'up'),
            computeTargetCell: () => ({ section: 'body', row: 0, col: 0 }),
            forceWidgetRebuild: true,
        });

        expect(result).toBe(true);
        expect(view.dispatch).toHaveBeenCalledTimes(1);

        const dispatched = view.dispatch.mock.calls[0][0] as {
            changes?: unknown;
            effects: Array<{ is?: (value: unknown) => boolean; value?: unknown }>;
        };
        expect(dispatched.changes).toBeUndefined();
        expect(dispatched.effects).toHaveLength(2);
        expect(dispatched.effects).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ value: expect.objectContaining({ section: 'body', row: 0, col: 0 }) }),
            ])
        );
    });

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

        const result = runTableOperationAndOpen({
            view: view as never,
            cell,
            operation: (table) => table.insertRowRelativeTo('body', 0, 'after'),
            computeTargetCell: () => ({ section: 'body', row: 1, col: 1 }),
            initialCursorPos: 'start',
        });

        expect(result).toBe(true);
        expect(view.dispatch).toHaveBeenCalledTimes(1);

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
            effect.is?.(requestOpenActiveCellEffect)
        );
        expect(openRequest?.value).toMatchObject({
            activeCell: { section: 'body', row: 1, col: 1 },
            normalizeIfNeeded: false,
        });
    });
});

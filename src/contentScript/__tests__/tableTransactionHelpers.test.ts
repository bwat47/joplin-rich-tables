import { resolveActiveCell } from '../tableRuntime/activeCellResolver';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { computeMarkdownTableCellRanges } from '../tableModel/markdownTableCellRanges';
import { runTableOperation } from '../tableRuntime/runTableOperation';

jest.mock('../tableRuntime/activeCellResolver', () => ({
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
        };
    }

    beforeEach(() => {
        (resolveActiveCell as jest.Mock).mockImplementation((_state, cell) => ({
            activeCell: cell,
            tableFrom: 0,
            tableTo: currentTableText.length,
            cellFrom: 0,
            cellTo: 0,
            ctx: {
                from: 0,
                to: currentTableText.length,
                text: currentTableText,
                table: MarkdownTable.parse(currentTableText),
                cellRanges: computeMarkdownTableCellRanges(currentTableText),
            },
        }));
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

        const dispatched = view.dispatch.mock.calls[0][0];
        expect(dispatched.changes).toBeUndefined();
        expect(dispatched.effects).toHaveLength(2);
        expect(dispatched.effects).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ value: expect.objectContaining({ section: 'body', row: 0, col: 0 }) }),
            ])
        );
    });
});

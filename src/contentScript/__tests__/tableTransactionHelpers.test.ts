import { runTableOperation } from '../tableModel/tableTransactionHelpers';

describe('tableTransactionHelpers', () => {
    function createView(tableText: string) {
        const dispatch = jest.fn();
        return {
            state: {
                sliceDoc: jest.fn((_from: number, _to: number) => tableText),
            },
            dispatch,
        };
    }

    function createCell(tableText: string) {
        return {
            tableFrom: 0,
            tableTo: tableText.length,
            cellFrom: 0,
            cellTo: 0,
            section: 'body' as const,
            row: 0,
            col: 0,
        };
    }

    it('re-serializes when serializeIfIdentity is enabled and markdown formatting changes', () => {
        const tableText = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');
        const view = createView(tableText);
        const cell = createCell(tableText);

        const result = runTableOperation({
            view: view as never,
            cell,
            operation: (table) => table,
            computeTargetCell: (active) => active,
            forceWidgetRebuild: true,
            serializeIfIdentity: true,
        });

        expect(result).toBe(true);
        expect(view.dispatch).toHaveBeenCalledTimes(1);
        const dispatched = view.dispatch.mock.calls[0][0];
        expect(dispatched.changes.insert).toBe(['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n'));
    });

    it('does not dispatch when identity and serialized text are unchanged', () => {
        const tableText = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');
        const view = createView(tableText);
        const cell = createCell(tableText);

        const result = runTableOperation({
            view: view as never,
            cell,
            operation: (table) => table,
            computeTargetCell: (active) => active,
            forceWidgetRebuild: true,
            serializeIfIdentity: true,
        });

        expect(result).toBe(false);
        expect(view.dispatch).not.toHaveBeenCalled();
    });
});

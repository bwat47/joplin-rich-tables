import type { EditorView } from '@codemirror/view';
import type { ActiveCell } from '../tableState/activeCellState';
import { MarkdownTable, type TableAlignment } from '../tableModel/MarkdownTable';
import type { StructuralTableCommand } from '../tableModel/structuralCommandSemantics';
import type { ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { runStructuralMutationAndReopen } from '../tableRuntime/operations/runStructuralMutation';
import { runStructuralAction, type StructuralActionId } from '../tableRuntime/operations/structuralActions';

jest.mock('../tableRuntime/operations/runStructuralMutation', () => ({
    runStructuralMutationAndReopen: jest.fn(),
}));

describe('structuralActions', () => {
    let view: EditorView;
    let resolvedCell: ResolvedActiveCell;
    let mockRunStructuralMutationAndReopen: jest.Mock;

    const createResolvedCell = (): ResolvedActiveCell => {
        const activeCell: ActiveCell = {
            tableFrom: 10,
            section: 'body',
            row: 1,
            col: 0,
        };

        return {
            activeCell,
            tableFrom: activeCell.tableFrom,
            tableTo: 100,
            contentFrom: 0,
            contentTo: 0,
            editableFrom: 0,
            editableTo: 0,
            ctx: {
                from: activeCell.tableFrom,
                to: 100,
                text: '',
                table: {} as MarkdownTable,
                cellRanges: { headers: [], rows: [] },
            },
        };
    };

    beforeEach(() => {
        view = {
            dispatch: jest.fn(),
            contentDOM: {
                focus: jest.fn(),
            },
        } as unknown as EditorView;
        resolvedCell = createResolvedCell();
        mockRunStructuralMutationAndReopen = runStructuralMutationAndReopen as jest.Mock;
        mockRunStructuralMutationAndReopen.mockReset();
        mockRunStructuralMutationAndReopen.mockReturnValue(true);
    });

    it.each([
        ['insertRowBefore', { type: 'insertRowBefore' }],
        ['insertRowAfter', { type: 'insertRowAfter' }],
        ['insertColumnBefore', { type: 'insertColumnBefore' }],
        ['insertColumnAfter', { type: 'insertColumnAfter' }],
        ['deleteRow', { type: 'deleteRow' }],
        ['deleteColumn', { type: 'deleteColumn' }],
        ['moveRowUp', { type: 'moveRowUp' }],
        ['moveRowDown', { type: 'moveRowDown' }],
        ['moveColumnLeft', { type: 'moveColumnLeft' }],
        ['moveColumnRight', { type: 'moveColumnRight' }],
        ['clearRow', { type: 'clearRow' }],
        ['clearColumn', { type: 'clearColumn' }],
        ['clearTable', { type: 'clearTable' }],
    ] satisfies Array<[StructuralActionId, StructuralTableCommand]>)(
        'maps model-backed action %s to its canonical command',
        (actionId, command) => {
            expect(runStructuralAction(view, actionId, resolvedCell)).toBe(true);

            expect(mockRunStructuralMutationAndReopen).toHaveBeenCalledWith(
                expect.objectContaining({
                    view,
                    resolvedCell,
                    command,
                })
            );
        }
    );

    it.each([
        ['alignLeft', 'left'],
        ['alignCenter', 'center'],
        ['alignRight', 'right'],
    ] satisfies Array<[StructuralActionId, TableAlignment]>)(
        'maps alignment action %s to an alignColumn command',
        (actionId, alignment) => {
            expect(runStructuralAction(view, actionId, resolvedCell)).toBe(true);

            expect(mockRunStructuralMutationAndReopen).toHaveBeenCalledWith(
                expect.objectContaining({
                    view,
                    resolvedCell,
                    command: { type: 'alignColumn', alignment },
                })
            );
        }
    );

    it('keeps deleteTable as a runtime-only action', () => {
        expect(runStructuralAction(view, 'deleteTable', resolvedCell)).toBe(true);

        expect(mockRunStructuralMutationAndReopen).not.toHaveBeenCalled();
        expect(view.dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                changes: { from: 10, to: 100, insert: '' },
            })
        );
    });
});

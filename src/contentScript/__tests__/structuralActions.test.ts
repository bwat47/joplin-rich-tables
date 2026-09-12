import { vi, type Mock } from 'vitest';
import type { EditorView } from '@codemirror/view';
import type { ActiveCell } from '../tableState/activeCellState';
import { MarkdownTable, type TableAlignment } from '../tableModel/MarkdownTable';
import type { ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { runStructuralMutationAndReopen } from '../tableRuntime/operations/runStructuralMutation';
import { runStructuralAction, type StructuralActionId } from '../tableRuntime/operations/structuralActions';

vi.mock('../tableRuntime/operations/runStructuralMutation', () => ({
    runStructuralMutationAndReopen: vi.fn(),
}));

describe('structuralActions', () => {
    let view: EditorView;
    let resolvedCell: ResolvedActiveCell;
    let mockRunStructuralMutationAndReopen: Mock;

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
            dispatch: vi.fn(),
            contentDOM: {
                focus: vi.fn(),
            },
        } as unknown as EditorView;
        resolvedCell = createResolvedCell();
        mockRunStructuralMutationAndReopen = runStructuralMutationAndReopen as Mock;
        mockRunStructuralMutationAndReopen.mockReset();
        mockRunStructuralMutationAndReopen.mockReturnValue(true);
    });

    it('routes a model-backed action and returns the mutation result', () => {
        mockRunStructuralMutationAndReopen.mockReturnValue(false);

        expect(runStructuralAction(view, 'insertRowBefore', resolvedCell)).toBe(false);
        expect(mockRunStructuralMutationAndReopen).toHaveBeenCalledWith(
            expect.objectContaining({
                view,
                resolvedCell,
                command: { type: 'insertRowBefore' },
            })
        );
    });

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
});

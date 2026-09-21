import { vi, type Mock } from 'vitest';
import type { EditorView } from '@codemirror/view';
import type { ActiveCell } from '../tableState/activeCellState';
import { MarkdownTable, type TableAlignment } from '../tableModel/MarkdownTable';
import type { ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { runStructuralCommand } from '../tableRuntime/operations/runStructuralCommand';
import { runStructuralAction, type StructuralActionId } from '../tableRuntime/operations/structuralActions';

vi.mock('../tableRuntime/operations/runStructuralCommand', () => ({
    runStructuralCommand: vi.fn(),
}));

describe('structuralActions', () => {
    let view: EditorView;
    let resolvedCell: ResolvedActiveCell;
    let mockRunStructuralCommand: Mock;

    const createResolvedCell = (): ResolvedActiveCell => {
        const activeCell: ActiveCell = {
            tableFrom: 10,
            section: 'body',
            row: 1,
            col: 0,
        };

        return {
            activeCell,
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
        mockRunStructuralCommand = runStructuralCommand as Mock;
        mockRunStructuralCommand.mockReset();
        mockRunStructuralCommand.mockReturnValue(true);
    });

    /**
     * Only the alignment actions are worth asserting. `modelBackedCommands` is pinned per key by
     * `satisfies StructuralTableCommandById`, so a transposed entry there is a compile error;
     * `alignmentCommands` pins only the value type, so a transposed alignment still compiles and
     * needs a test.
     */
    it.each([
        ['alignLeft', 'left'],
        ['alignCenter', 'center'],
        ['alignRight', 'right'],
    ] satisfies Array<[StructuralActionId, TableAlignment]>)(
        'maps alignment action %s to an alignColumn command',
        (actionId, alignment) => {
            expect(runStructuralAction(view, actionId, resolvedCell)).toBe(true);

            expect(mockRunStructuralCommand).toHaveBeenCalledWith(view, resolvedCell, {
                type: 'alignColumn',
                alignment,
            });
        }
    );
});

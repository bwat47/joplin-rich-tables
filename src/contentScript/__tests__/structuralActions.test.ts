import { vi, type Mock } from 'vitest';
import type { EditorView } from '@codemirror/view';
import type { ActiveCell } from '../tableState/activeCellState';
import type { MarkdownTable, TableAlignment } from '../tableModel/MarkdownTable';
import { getResolvedActiveCell, type ResolvedActiveCell } from '../tableState/resolvedActiveCell';
import { refocusNestedEditor } from '../nestedEditor/nestedEditorController';
import { runStructuralCommand } from '../tableRuntime/operations/runStructuralCommand';
import {
    runStructuralAction,
    runStructuralActionOnActiveCell,
    type StructuralActionId,
} from '../tableRuntime/operations/structuralActions';

vi.mock('../tableRuntime/operations/runStructuralCommand', () => ({
    runStructuralCommand: vi.fn(),
}));

vi.mock('../tableState/resolvedActiveCell', () => ({
    getResolvedActiveCell: vi.fn(),
}));

vi.mock('../nestedEditor/nestedEditorController', () => ({
    refocusNestedEditor: vi.fn(),
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
        vi.mocked(getResolvedActiveCell).mockReset();
        vi.mocked(getResolvedActiveCell).mockReturnValue(resolvedCell);
        vi.mocked(refocusNestedEditor).mockReset();
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

    describe('runStructuralActionOnActiveCell', () => {
        it('runs the action on the resolved active cell without refocusing when handled', () => {
            expect(runStructuralActionOnActiveCell(view, 'moveRowUp')).toBe(true);

            expect(mockRunStructuralCommand).toHaveBeenCalledWith(view, resolvedCell, { type: 'moveRowUp' });
            expect(refocusNestedEditor).not.toHaveBeenCalled();
        });

        it('refocuses the nested editor when the action is a no-op', () => {
            mockRunStructuralCommand.mockReturnValue(false);

            expect(runStructuralActionOnActiveCell(view, 'moveRowUp')).toBe(false);

            expect(refocusNestedEditor).toHaveBeenCalledWith(view);
        });

        it('refocuses the nested editor without running the action when the active cell no longer resolves', () => {
            vi.mocked(getResolvedActiveCell).mockReturnValue(null);

            expect(runStructuralActionOnActiveCell(view, 'moveRowUp')).toBe(false);

            expect(mockRunStructuralCommand).not.toHaveBeenCalled();
            expect(refocusNestedEditor).toHaveBeenCalledWith(view);
        });
    });
});

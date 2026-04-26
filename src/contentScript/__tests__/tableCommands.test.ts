import { EditorView } from '@codemirror/view';
import type { ActiveCell } from '../tableState/activeCellState';
import { resolveActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { runStructuralMutationAndReopen } from '../tableRuntime/operations/runStructuralMutation';
import type { TargetCell } from '../tableModel/activeCellForTableText';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import {
    clearColumn,
    clearRow,
    clearTable,
    deleteColumn,
    deleteRow,
    deleteTable,
    getDefaultRowInsertOpenOptions,
    getDefaultStructuralReopenOptions,
    insertColumnLeft,
    insertColumnRight,
    insertRowAbove,
    insertRowBelow,
    moveColumnLeft,
    moveColumnRight,
    moveRowDown,
    moveRowUp,
    updateAlignment,
} from '../tableRuntime/operations/structuralOperations';

// Mock dependencies
jest.mock('../tableRuntime/operations/runStructuralMutation', () => ({
    runStructuralMutationAndReopen: jest.fn(),
}));
jest.mock('../tableRuntime/activeCell/resolvedActiveCell', () => ({
    resolveActiveCell: jest.fn(),
}));

describe('tableCommands (computTargetCell)', () => {
    let mockView: EditorView;
    let mockRunStructuralMutationAndReopen: jest.Mock;
    let mockResolveActiveCell: jest.Mock;

    beforeEach(() => {
        mockView = {
            contentDOM: {
                focus: jest.fn(),
            },
        } as unknown as EditorView;
        mockRunStructuralMutationAndReopen = runStructuralMutationAndReopen as jest.Mock;
        mockRunStructuralMutationAndReopen.mockClear();
        mockResolveActiveCell = resolveActiveCell as jest.Mock;
        mockResolveActiveCell.mockReset();
    });

    // Helper to invoke a command and check the computeTargetCell logic
    const testCommand = (
        command: (view: EditorView, cell: ActiveCell) => void,
        startCell: ActiveCell,
        expectedTarget: TargetCell,
        // Optional mocks for old/new table data if logic depends on it (usually doesn't for simple moves)
        mockOldTable: MarkdownTable = {} as MarkdownTable,
        mockNewTable: MarkdownTable = {} as MarkdownTable
    ) => {
        command(mockView, startCell);

        expect(mockRunStructuralMutationAndReopen).toHaveBeenCalledTimes(1);
        const params = mockRunStructuralMutationAndReopen.mock.calls[0][0];

        // Isolate the target computation function
        const computeTargetCell = params.computeTargetCell;
        const actualTarget = computeTargetCell(startCell, mockOldTable, mockNewTable);

        expect(actualTarget).toMatchObject(expectedTarget);
    };

    const createCell = (section: 'header' | 'body', row: number, col: number): ActiveCell => ({
        tableFrom: 0,
        section,
        row,
        col,
    });

    describe('insertRow', () => {
        it('insertRowAbove (header) -> stay in header', () => {
            testCommand(
                insertRowAbove,
                createCell('header', 0, 1),
                { section: 'header', row: 0, col: 1 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });

        it('insertRowAbove (body) -> stay in current row index (push down)', () => {
            testCommand(
                insertRowAbove,
                createCell('body', 5, 1),
                { section: 'body', row: 5, col: 1 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });

        it('insertRowBelow (header) -> move to first body row', () => {
            testCommand(
                insertRowBelow,
                createCell('header', 0, 1),
                { section: 'body', row: 0, col: 1 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });

        it('insertRowBelow (body) -> move to next row', () => {
            testCommand(
                insertRowBelow,
                createCell('body', 5, 1),
                { section: 'body', row: 6, col: 1 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });

        it('routes row insertion through runStructuralMutationAndReopen with row defaults', () => {
            const cell = createCell('body', 1, 1);

            insertRowBelow(mockView, cell);

            expect(mockRunStructuralMutationAndReopen).toHaveBeenCalledWith(
                expect.objectContaining({
                    view: mockView,
                    cell,
                    initialCursorPos: 'start',
                    afterDispatch: expect.any(Function),
                })
            );
            const afterDispatch = mockRunStructuralMutationAndReopen.mock.calls[0][0].afterDispatch as () => void;
            afterDispatch();
            expect(mockView.contentDOM.focus).toHaveBeenCalledWith({ preventScroll: true });
        });
    });

    describe('insertColumn', () => {
        it('insertColumnLeft -> stay in current col index', () => {
            testCommand(
                insertColumnLeft,
                createCell('body', 2, 3),
                { section: 'body', row: 2, col: 3 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });

        it('insertColumnRight -> move to next col index', () => {
            testCommand(
                insertColumnRight,
                createCell('body', 2, 3),
                { section: 'body', row: 2, col: 4 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });

        it('routes non-row structural operations through shared reopen defaults', () => {
            const cell = createCell('body', 2, 3);

            insertColumnRight(mockView, cell);

            expect(mockRunStructuralMutationAndReopen).toHaveBeenCalledWith(
                expect.objectContaining({
                    view: mockView,
                    cell,
                    afterDispatch: expect.any(Function),
                })
            );
            expect(mockRunStructuralMutationAndReopen.mock.calls[0][0].initialCursorPos).toBeUndefined();
        });
    });

    describe('deleteRow', () => {
        it('deleteRow (header) -> promote first body row (header)', () => {
            testCommand(
                deleteRow,
                createCell('header', 0, 2),
                { section: 'header', row: 0, col: 2 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });

        it('deleteRow (body row 0) -> move to 0', () => {
            testCommand(
                deleteRow,
                createCell('body', 0, 2),
                { section: 'body', row: 0, col: 2 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });

        it('deleteRow (body row > 0) -> move up', () => {
            testCommand(
                deleteRow,
                createCell('body', 5, 2),
                { section: 'body', row: 4, col: 2 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });
    });

    describe('deleteColumn', () => {
        it('deleteColumn (col 0) -> stay 0', () => {
            testCommand(
                deleteColumn,
                createCell('body', 1, 0),
                { section: 'body', row: 1, col: 0 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });

        it('deleteColumn (col > 0) -> move left', () => {
            testCommand(
                deleteColumn,
                createCell('body', 1, 5),
                { section: 'body', row: 1, col: 4 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });
    });

    describe('moveRow', () => {
        it('moveRowUp (row 0) -> move to header', () => {
            testCommand(
                moveRowUp,
                createCell('body', 0, 1),
                { section: 'header', row: 0, col: 1 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });

        it('moveRowUp (row > 0) -> move up', () => {
            testCommand(
                moveRowUp,
                createCell('body', 5, 1),
                { section: 'body', row: 4, col: 1 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });

        it('moveRowDown (header) -> move to body 0', () => {
            testCommand(
                moveRowDown,
                createCell('header', 0, 1),
                { section: 'body', row: 0, col: 1 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });

        it('moveRowDown (body) -> move down', () => {
            testCommand(
                moveRowDown,
                createCell('body', 5, 1),
                { section: 'body', row: 6, col: 1 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });
    });

    describe('moveColumn', () => {
        it('moveColumnLeft -> move left', () => {
            testCommand(
                moveColumnLeft,
                createCell('body', 2, 3),
                { section: 'body', row: 2, col: 2 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });

        it('moveColumnRight -> move right', () => {
            testCommand(
                moveColumnRight,
                createCell('body', 2, 3),
                { section: 'body', row: 2, col: 4 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });
    });

    describe('clearTable', () => {
        it('clearRow -> stay in same cell', () => {
            testCommand(
                clearRow,
                createCell('body', 2, 1),
                { section: 'body', row: 2, col: 1 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });

        it('clearColumn -> stay in same cell', () => {
            testCommand(
                clearColumn,
                createCell('body', 2, 1),
                { section: 'body', row: 2, col: 1 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });

        it('clearTable -> stay in same cell', () => {
            testCommand(
                clearTable,
                createCell('body', 2, 1),
                { section: 'body', row: 2, col: 1 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });

        it('clearTable (header) -> stay in header', () => {
            testCommand(
                clearTable,
                createCell('header', 0, 0),
                { section: 'header', row: 0, col: 0 },
                {} as MarkdownTable,
                {} as MarkdownTable
            );
        });

        it('updateAlignment keeps the same target cell and uses reopen dispatch', () => {
            const cell = createCell('body', 2, 1);

            updateAlignment(mockView, cell, 'center');

            expect(mockRunStructuralMutationAndReopen).toHaveBeenCalledTimes(1);
            const params = mockRunStructuralMutationAndReopen.mock.calls[0][0];
            expect(params.computeTargetCell(cell, {} as MarkdownTable, {} as MarkdownTable)).toMatchObject(cell);
        });
    });

    describe('defaults', () => {
        it('getDefaultStructuralReopenOptions focuses the main editor after dispatch', () => {
            const options = getDefaultStructuralReopenOptions(mockView);

            options.afterDispatch?.();

            expect(mockView.contentDOM.focus).toHaveBeenCalledWith({ preventScroll: true });
        });

        it('getDefaultRowInsertOpenOptions adds start cursor placement on top of structural defaults', () => {
            const options = getDefaultRowInsertOpenOptions(mockView);

            expect(options.initialCursorPos).toBe('start');
            options.afterDispatch?.();
            expect(mockView.contentDOM.focus).toHaveBeenCalledWith({ preventScroll: true });
        });
    });

    describe('deleteTable', () => {
        it('deleteTable dispatches deletion with clearActiveCellEffect', () => {
            const dispatchMock = jest.fn();
            const mockEditorView = {
                dispatch: dispatchMock,
                state: {},
                contentDOM: { focus: jest.fn() },
            } as unknown as EditorView;
            const cell = createCell('body', 1, 0);
            cell.tableFrom = 10;
            mockResolveActiveCell.mockReturnValue({
                tableFrom: 10,
                tableTo: 100,
            });

            deleteTable(mockEditorView, cell);

            expect(dispatchMock).toHaveBeenCalledTimes(1);
            const arg = dispatchMock.mock.calls[0][0];
            expect(arg.changes).toEqual({ from: 10, to: 100, insert: '' });
            expect(arg.effects).toHaveLength(2);
        });
    });
});

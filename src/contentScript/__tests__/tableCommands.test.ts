import { EditorView } from '@codemirror/view';
import type { ActiveCell } from '../tableState/activeCellState';
import { resolveActiveCell } from '../tableRuntime/activeCell/activeCellResolver';
import { runTableOperation, runTableOperationAndOpen } from '../tableRuntime/operations/runTableOperation';
import { TargetCell } from '../tableModel/activeCellForTableText';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import {
    execInsertRowAbove,
    execInsertRowBelow,
    execInsertColumnLeft,
    execInsertColumnRight,
    execDeleteRow,
    execDeleteColumn,
    execMoveRowUp,
    execMoveRowDown,
    execMoveColumnLeft,
    execMoveColumnRight,
    execClearRow,
    execClearColumn,
    execClearTable,
    execDeleteTable,
} from '../tableRuntime/operations/tableOperations';

// Mock dependencies
jest.mock('../tableRuntime/operations/runTableOperation', () => ({
    runTableOperation: jest.fn(),
    runTableOperationAndOpen: jest.fn(),
}));
jest.mock('../tableRuntime/activeCell/activeCellResolver', () => ({
    resolveActiveCell: jest.fn(),
}));

describe('tableCommands (computTargetCell)', () => {
    let mockView: EditorView;
    let mockRunTableOperation: jest.Mock;
    let mockRunTableOperationAndOpen: jest.Mock;
    let mockResolveActiveCell: jest.Mock;

    beforeEach(() => {
        mockView = {} as EditorView;
        mockRunTableOperation = runTableOperation as jest.Mock;
        mockRunTableOperation.mockClear();
        mockRunTableOperationAndOpen = runTableOperationAndOpen as jest.Mock;
        mockRunTableOperationAndOpen.mockClear();
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
        mockNewTable: MarkdownTable = {} as MarkdownTable,
        runner: 'plain' | 'open' = 'plain'
    ) => {
        command(mockView, startCell);

        const mockRunner = runner === 'open' ? mockRunTableOperationAndOpen : mockRunTableOperation;
        expect(mockRunner).toHaveBeenCalledTimes(1);
        const params = mockRunner.mock.calls[0][0];

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
        it('execInsertRowAbove (header) -> stay in header', () => {
            testCommand(
                execInsertRowAbove,
                createCell('header', 0, 1),
                { section: 'header', row: 0, col: 1 },
                {} as MarkdownTable,
                {} as MarkdownTable,
                'open'
            );
        });

        it('execInsertRowAbove (body) -> stay in current row index (push down)', () => {
            testCommand(
                execInsertRowAbove,
                createCell('body', 5, 1),
                { section: 'body', row: 5, col: 1 },
                {} as MarkdownTable,
                {} as MarkdownTable,
                'open'
            );
        });

        it('execInsertRowBelow (header) -> move to first body row', () => {
            testCommand(
                execInsertRowBelow,
                createCell('header', 0, 1),
                { section: 'body', row: 0, col: 1 },
                {} as MarkdownTable,
                {} as MarkdownTable,
                'open'
            );
        });

        it('execInsertRowBelow (body) -> move to next row', () => {
            testCommand(
                execInsertRowBelow,
                createCell('body', 5, 1),
                { section: 'body', row: 6, col: 1 },
                {} as MarkdownTable,
                {} as MarkdownTable,
                'open'
            );
        });

        it('routes row insertion through runTableOperationAndOpen with start cursor defaults', () => {
            const cell = createCell('body', 1, 1);

            execInsertRowBelow(mockView, cell);

            expect(mockRunTableOperationAndOpen).toHaveBeenCalledWith(
                expect.objectContaining({
                    view: mockView,
                    cell,
                    initialCursorPos: 'start',
                })
            );
            expect(mockRunTableOperation).not.toHaveBeenCalled();
        });
    });

    describe('insertColumn', () => {
        it('execInsertColumnLeft -> stay in current col index', () => {
            testCommand(execInsertColumnLeft, createCell('body', 2, 3), { section: 'body', row: 2, col: 3 });
        });

        it('execInsertColumnRight -> move to next col index', () => {
            testCommand(execInsertColumnRight, createCell('body', 2, 3), { section: 'body', row: 2, col: 4 });
        });
    });

    describe('deleteRow', () => {
        it('execDeleteRow (header) -> promote first body row (header)', () => {
            testCommand(execDeleteRow, createCell('header', 0, 2), { section: 'header', row: 0, col: 2 });
        });

        it('execDeleteRow (body row 0) -> move to 0', () => {
            testCommand(execDeleteRow, createCell('body', 0, 2), { section: 'body', row: 0, col: 2 });
        });

        it('execDeleteRow (body row > 0) -> move up', () => {
            testCommand(execDeleteRow, createCell('body', 5, 2), { section: 'body', row: 4, col: 2 });
        });
    });

    describe('deleteColumn', () => {
        it('execDeleteColumn (col 0) -> stay 0', () => {
            testCommand(execDeleteColumn, createCell('body', 1, 0), { section: 'body', row: 1, col: 0 });
        });

        it('execDeleteColumn (col > 0) -> move left', () => {
            testCommand(
                execDeleteColumn,
                createCell('body', 1, 5),
                { section: 'body', row: 1, col: 4 } // 5 - 1
            );
        });
    });

    describe('moveRow', () => {
        it('execMoveRowUp (row 0) -> move to header', () => {
            testCommand(execMoveRowUp, createCell('body', 0, 1), { section: 'header', row: 0, col: 1 });
        });

        it('execMoveRowUp (row > 0) -> move up', () => {
            testCommand(execMoveRowUp, createCell('body', 5, 1), { section: 'body', row: 4, col: 1 });
        });

        it('execMoveRowDown (header) -> move to body 0', () => {
            testCommand(execMoveRowDown, createCell('header', 0, 1), { section: 'body', row: 0, col: 1 });
        });

        it('execMoveRowDown (body) -> move down', () => {
            testCommand(execMoveRowDown, createCell('body', 5, 1), { section: 'body', row: 6, col: 1 });
        });
    });

    describe('moveColumn', () => {
        it('execMoveColumnLeft -> move left', () => {
            testCommand(execMoveColumnLeft, createCell('body', 2, 3), { section: 'body', row: 2, col: 2 });
        });

        it('execMoveColumnRight -> move right', () => {
            testCommand(execMoveColumnRight, createCell('body', 2, 3), { section: 'body', row: 2, col: 4 });
        });
    });

    describe('clearTable', () => {
        it('execClearRow -> stay in same cell', () => {
            testCommand(execClearRow, createCell('body', 2, 1), { section: 'body', row: 2, col: 1 });
        });

        it('execClearColumn -> stay in same cell', () => {
            testCommand(execClearColumn, createCell('body', 2, 1), { section: 'body', row: 2, col: 1 });
        });

        it('execClearTable -> stay in same cell', () => {
            testCommand(execClearTable, createCell('body', 2, 1), { section: 'body', row: 2, col: 1 });
        });

        it('execClearTable (header) -> stay in header', () => {
            testCommand(execClearTable, createCell('header', 0, 0), { section: 'header', row: 0, col: 0 });
        });
    });

    describe('deleteTable', () => {
        it('execDeleteTable dispatches deletion with clearActiveCellEffect', () => {
            const dispatchMock = jest.fn();
            const mockEditorView = { dispatch: dispatchMock, state: {} } as unknown as EditorView;
            const cell = createCell('body', 1, 0);
            cell.tableFrom = 10;
            mockResolveActiveCell.mockReturnValue({
                tableFrom: 10,
                tableTo: 100,
            });

            execDeleteTable(mockEditorView, cell);

            expect(dispatchMock).toHaveBeenCalledTimes(1);
            const arg = dispatchMock.mock.calls[0][0];
            expect(arg.changes).toEqual({ from: 10, to: 100, insert: '' });
            expect(arg.effects).toHaveLength(2);
        });
    });
});

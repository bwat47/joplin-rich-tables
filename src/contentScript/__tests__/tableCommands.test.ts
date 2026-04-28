import { EditorView } from '@codemirror/view';
import type { ActiveCell } from '../tableState/activeCellState';
import { getResolvedActiveCell, type ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { runStructuralMutationAndReopen } from '../tableRuntime/operations/runStructuralMutation';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { registerTableCommands } from '../tableCommands/tableCommands';
import {
    deleteTable,
    getDefaultRowInsertOpenOptions,
    getDefaultStructuralReopenOptions,
    runStructuralCommand,
    updateAlignment,
} from '../tableRuntime/operations/structuralOperations';

// Mock dependencies
jest.mock('../tableRuntime/operations/runStructuralMutation', () => ({
    runStructuralMutationAndReopen: jest.fn(),
}));
jest.mock('../tableRuntime/activeCell/resolvedActiveCell', () => ({
    getResolvedActiveCell: jest.fn(),
}));

describe('tableCommands', () => {
    let mockView: EditorView;
    let mockRunStructuralMutationAndReopen: jest.Mock;
    let mockGetResolvedActiveCell: jest.Mock;

    beforeEach(() => {
        mockView = {
            contentDOM: {
                focus: jest.fn(),
            },
        } as unknown as EditorView;
        mockRunStructuralMutationAndReopen = runStructuralMutationAndReopen as jest.Mock;
        mockRunStructuralMutationAndReopen.mockClear();
        mockGetResolvedActiveCell = getResolvedActiveCell as jest.Mock;
        mockGetResolvedActiveCell.mockReset();
    });

    const createCell = (section: 'header' | 'body', row: number, col: number): ActiveCell => ({
        tableFrom: 0,
        section,
        row,
        col,
    });

    const createResolvedCell = (activeCell: ActiveCell): ResolvedActiveCell =>
        ({
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
        }) satisfies ResolvedActiveCell;

    describe('runtime structural operations', () => {
        it('routes row insertion through runStructuralMutationAndReopen with row defaults', () => {
            const cell = createCell('body', 1, 1);
            const resolvedCell = createResolvedCell(cell);

            runStructuralCommand(mockView, resolvedCell, { type: 'insertRowAfter' });

            expect(mockRunStructuralMutationAndReopen).toHaveBeenCalledWith(
                expect.objectContaining({
                    view: mockView,
                    resolvedCell,
                    command: { type: 'insertRowAfter' },
                    initialCursorPos: 'start',
                    afterDispatch: expect.any(Function),
                })
            );
            const afterDispatch = mockRunStructuralMutationAndReopen.mock.calls[0][0].afterDispatch as () => void;
            afterDispatch();
            expect(mockView.contentDOM.focus).toHaveBeenCalledWith({ preventScroll: true });
        });

        it('routes non-row structural operations through shared reopen defaults', () => {
            const cell = createCell('body', 2, 3);
            const resolvedCell = createResolvedCell(cell);

            runStructuralCommand(mockView, resolvedCell, { type: 'insertColumnAfter' });

            expect(mockRunStructuralMutationAndReopen).toHaveBeenCalledWith(
                expect.objectContaining({
                    view: mockView,
                    resolvedCell,
                    command: { type: 'insertColumnAfter' },
                    afterDispatch: expect.any(Function),
                })
            );
            expect(mockRunStructuralMutationAndReopen.mock.calls[0][0].initialCursorPos).toBeUndefined();
        });
        it('routes alignment updates through the command path', () => {
            const cell = createCell('body', 2, 1);
            const resolvedCell = createResolvedCell(cell);

            updateAlignment(mockView, resolvedCell, 'center');

            expect(mockRunStructuralMutationAndReopen).toHaveBeenCalledTimes(1);
            const params = mockRunStructuralMutationAndReopen.mock.calls[0][0];
            expect(params.command).toEqual({ type: 'alignColumn', alignment: 'center' });
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
            const resolvedCell = createResolvedCell(cell);

            deleteTable(mockEditorView, resolvedCell);

            expect(dispatchMock).toHaveBeenCalledTimes(1);
            const arg = dispatchMock.mock.calls[0][0];
            expect(arg.changes).toEqual({ from: 10, to: 100, insert: '' });
            expect(arg.effects).toHaveLength(2);
        });
    });

    describe('registerTableCommands', () => {
        function createEditorControl() {
            const callbacks = new Map<string, (...args: unknown[]) => unknown>();
            const cm6 = {
                state: { doc: { length: 0 } },
                contentDOM: { focus: jest.fn() },
            } as unknown as EditorView;

            return {
                callbacks,
                editorControl: {
                    editor: cm6,
                    cm6,
                    addExtension: jest.fn(),
                    registerCommand: jest.fn((name: string, callback: (...args: unknown[]) => unknown) => {
                        callbacks.set(name, callback);
                    }),
                },
            };
        }

        it('resolves the active cell once before running a structural command', () => {
            const { callbacks, editorControl } = createEditorControl();
            const cell = createCell('body', 1, 1);
            const resolvedCell = createResolvedCell(cell);
            mockGetResolvedActiveCell.mockReturnValue(resolvedCell);
            registerTableCommands(editorControl);

            const result = callbacks.get('richTables.addRowBelow')?.();

            expect(result).toBeUndefined();
            expect(mockGetResolvedActiveCell).toHaveBeenCalledWith(editorControl.cm6.state);
            expect(mockRunStructuralMutationAndReopen).toHaveBeenCalledWith(
                expect.objectContaining({
                    view: editorControl.cm6,
                    resolvedCell,
                    initialCursorPos: 'start',
                })
            );
        });

        it('returns false and does not run an action when no active cell resolves', () => {
            const { callbacks, editorControl } = createEditorControl();
            mockGetResolvedActiveCell.mockReturnValue(null);
            registerTableCommands(editorControl);

            const result = callbacks.get('richTables.deleteColumn')?.();

            expect(result).toBe(false);
            expect(mockGetResolvedActiveCell).toHaveBeenCalledWith(editorControl.cm6.state);
            expect(mockRunStructuralMutationAndReopen).not.toHaveBeenCalled();
        });
    });
});

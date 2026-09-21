import { EditorView } from '@codemirror/view';
import { vi, type Mock } from 'vitest';
import type { ActiveCell } from '../tableState/activeCellState';
import { getResolvedActiveCell, type ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { runStructuralCommand } from '../tableRuntime/operations/runStructuralCommand';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { registerTableCommands } from '../tableCommands/tableCommands';

// Mock dependencies
vi.mock('../tableRuntime/operations/runStructuralCommand', () => ({
    runStructuralCommand: vi.fn(),
}));
vi.mock('../tableRuntime/activeCell/resolvedActiveCell', () => ({
    getResolvedActiveCell: vi.fn(),
}));

describe('tableCommands', () => {
    let mockRunStructuralCommand: Mock;
    let mockGetResolvedActiveCell: Mock;

    beforeEach(() => {
        mockRunStructuralCommand = runStructuralCommand as Mock;
        mockRunStructuralCommand.mockClear();
        mockGetResolvedActiveCell = getResolvedActiveCell as Mock;
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

    describe('registerTableCommands', () => {
        function createEditorControl() {
            const callbacks = new Map<string, (...args: unknown[]) => unknown>();
            const cm6 = {
                state: { doc: { length: 0 } },
                contentDOM: { focus: vi.fn() },
            } as unknown as EditorView;

            return {
                callbacks,
                editorControl: {
                    editor: cm6,
                    cm6,
                    addExtension: vi.fn(),
                    registerCommand: vi.fn((name: string, callback: (...args: unknown[]) => unknown) => {
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
            expect(mockRunStructuralCommand).toHaveBeenCalledWith(editorControl.cm6, resolvedCell, {
                type: 'insertRowAfter',
            });
        });

        it('returns false and does not run an action when no active cell resolves', () => {
            const { callbacks, editorControl } = createEditorControl();
            mockGetResolvedActiveCell.mockReturnValue(null);
            registerTableCommands(editorControl);

            const result = callbacks.get('richTables.deleteColumn')?.();

            expect(result).toBe(false);
            expect(mockGetResolvedActiveCell).toHaveBeenCalledWith(editorControl.cm6.state);
            expect(mockRunStructuralCommand).not.toHaveBeenCalled();
        });
    });
});

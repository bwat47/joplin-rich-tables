import { EditorView } from '@codemirror/view';
import { vi, type Mock } from 'vitest';
import type { ActiveCell } from '../tableState/activeCellState';
import { getResolvedActiveCell, type ResolvedActiveCell } from '../tableRuntime/activeCell/resolvedActiveCell';
import { runStructuralMutationAndReopen } from '../tableRuntime/operations/runStructuralMutation';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import type { StructuralTableCommand } from '../tableModel/structuralCommandSemantics';
import { registerTableCommands } from '../tableCommands/tableCommands';
import {
    getDefaultRowInsertOpenOptions,
    getDefaultStructuralReopenOptions,
    runStructuralCommand,
} from '../tableRuntime/operations/structuralOperations';

// Mock dependencies
vi.mock('../tableRuntime/operations/runStructuralMutation', () => ({
    runStructuralMutationAndReopen: vi.fn(),
}));
vi.mock('../tableRuntime/activeCell/resolvedActiveCell', () => ({
    getResolvedActiveCell: vi.fn(),
}));

describe('tableCommands', () => {
    let mockView: EditorView;
    let mockRunStructuralMutationAndReopen: Mock;
    let mockGetResolvedActiveCell: Mock;

    beforeEach(() => {
        mockView = {} as unknown as EditorView;
        mockRunStructuralMutationAndReopen = runStructuralMutationAndReopen as Mock;
        mockRunStructuralMutationAndReopen.mockClear();
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

    describe('runtime structural operations', () => {
        // What the defaults themselves do is covered below; this is only which set each
        // command picks.
        it.each([
            { command: { type: 'insertRowAfter' }, initialCursorPos: 'start' },
            { command: { type: 'insertColumnAfter' }, initialCursorPos: undefined },
        ] satisfies Array<{ command: StructuralTableCommand; initialCursorPos?: 'start' }>)(
            'gives $command.type an initialCursorPos of $initialCursorPos',
            ({ command, initialCursorPos }) => {
                const resolvedCell = createResolvedCell(createCell('body', 1, 1));

                runStructuralCommand(mockView, resolvedCell, command);

                expect(mockRunStructuralMutationAndReopen).toHaveBeenCalledWith(
                    expect.objectContaining({
                        view: mockView,
                        resolvedCell,
                        command,
                        afterDispatch: expect.any(Function),
                    })
                );
                expect(mockRunStructuralMutationAndReopen.mock.calls[0][0].initialCursorPos).toBe(initialCursorPos);
            }
        );
    });

    describe('defaults', () => {
        let view: EditorView;

        beforeEach(() => {
            const parent = document.createElement('div');
            document.body.appendChild(parent);
            view = new EditorView({
                parent,
                doc: ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'),
            });
            view.contentDOM.blur();
        });

        afterEach(() => {
            const parent = view.dom.parentElement;
            view.destroy();
            parent?.remove();
        });

        it('getDefaultStructuralReopenOptions hands focus back to the main editor after dispatch', () => {
            expect(document.activeElement).not.toBe(view.contentDOM);

            getDefaultStructuralReopenOptions(view).afterDispatch?.();

            expect(document.activeElement).toBe(view.contentDOM);
        });

        it('getDefaultRowInsertOpenOptions adds start cursor placement on top of structural defaults', () => {
            const options = getDefaultRowInsertOpenOptions(view);

            expect(options.initialCursorPos).toBe('start');

            options.afterDispatch?.();

            expect(document.activeElement).toBe(view.contentDOM);
        });
    });

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

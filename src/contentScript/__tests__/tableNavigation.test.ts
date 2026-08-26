import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { vi, type Mock } from 'vitest';
import { navigateCell } from '../tableRuntime/navigation/tableNavigation';
import { getResolvedActiveCell, resolveCellWithinResolvedTable } from '../tableRuntime/activeCell/resolvedActiveCell';
import { SECTION_BODY, SECTION_HEADER } from '../tableWidget/domHelpers';

import { clearActiveCellEffect, setActiveCellEffect } from '../tableState/activeCellState';
import { triggerOpenCellRequestEffect } from '../tableRuntime/openCellRequest';
import { insertRowAtBottom } from '../tableRuntime/operations/structuralOperations';
import { beginOpenCellRequestEffect } from '../tableRuntime/openCellRequest';

// Mock dependencies (not activeCellState - we need the real StateEffect identity)
vi.mock('../tableRuntime/activeCell/resolvedActiveCell', () => ({
    getResolvedActiveCell: vi.fn(),
    resolveCellWithinResolvedTable: vi.fn(),
}));
vi.mock('../tableRuntime/operations/structuralOperations', () => ({
    __esModule: true,
    insertRowAtBottom: vi.fn(),
}));

describe('navigateCell', () => {
    let mockView: EditorView;
    let mockState: EditorState;
    let mockDispatch: Mock;
    let currentCtx: {
        from: number;
        to: number;
        text: string;
        table: Record<string, never>;
        cellRanges: {
            headers: Array<Record<string, never>>;
            rows: Array<Array<Record<string, never>>>;
        };
    } | null;

    beforeEach(() => {
        mockDispatch = vi.fn();
        currentCtx = null;
        mockState = {
            field: vi.fn(),
            doc: { length: 100 },
        } as unknown as EditorState;

        mockView = {
            state: mockState,
            dispatch: mockDispatch,
            focus: vi.fn(),
            contentDOM: {
                focus: vi.fn(),
                querySelectorAll: vi.fn().mockReturnValue([]),
            },
            dom: {
                querySelector: vi.fn(),
                querySelectorAll: vi.fn().mockReturnValue([]),
            },
            posAtDOM: vi.fn().mockReturnValue(0), // Mock for findCellElement
        } as unknown as EditorView;

        // Reset mocks
        (getResolvedActiveCell as Mock).mockReset();
        (resolveCellWithinResolvedTable as Mock).mockReset();
        (insertRowAtBottom as Mock).mockReset();
    });

    const getEffects = () => {
        const effects = mockDispatch.mock.calls[0]?.[0]?.effects;
        if (!effects) return [];
        return Array.isArray(effects) ? effects : [effects];
    };

    const getSetActiveCellValue = () => getEffects().find((effect) => effect.is?.(setActiveCellEffect))?.value;
    const getOpenRequestValue = () => getEffects().find((effect) => effect.is?.(triggerOpenCellRequestEffect))?.value;
    const getBeginRequestValue = () => getEffects().find((effect) => effect.is?.(beginOpenCellRequestEffect))?.value;

    const setupTable = (rows: number, cols: number) => {
        const headers = Array(cols).fill({});
        const bodyRows = Array(rows).fill(Array(cols).fill({}));
        currentCtx = {
            from: 0,
            to: 100,
            text: '| header |\n| --- |\n| body |',
            table: {},
            cellRanges: {
                headers,
                rows: bodyRows,
            },
        };

        (resolveCellWithinResolvedTable as Mock).mockImplementation(
            (_resolved: unknown, target: { section: 'header' | 'body'; row: number; col: number }) => ({
                activeCell: {
                    tableFrom: 0,
                    section: target.section,
                    row: target.row,
                    col: target.col,
                },
                editableFrom: 10,
                editableTo: 20,
            })
        );

        return currentCtx;
    };

    const setupActiveCell = (section: 'header' | 'body', row: number, col: number) => {
        if (!currentCtx) {
            throw new Error('setupTable must be called before setupActiveCell');
        }

        const activeCell = {
            tableFrom: 0,
            section,
            row,
            col,
        };

        const resolvedCell = {
            activeCell,
            contentFrom: 10,
            contentTo: 20,
            editableFrom: 10,
            editableTo: 20,
            ctx: currentCtx,
        };

        (getResolvedActiveCell as Mock).mockReturnValue(resolvedCell);

        return resolvedCell;
    };

    it('should return false if no active cell', () => {
        (getResolvedActiveCell as Mock).mockReturnValue(null);
        expect(navigateCell(mockView, 'next')).toBe(false);
    });

    it('should navigate next within header', () => {
        setupTable(1, 2); // 2 cols
        setupActiveCell(SECTION_HEADER, 0, 0);

        navigateCell(mockView, 'next');

        expect(mockDispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                effects: expect.anything(),
            })
        );

        expect(getSetActiveCellValue()).toMatchObject({
            section: SECTION_HEADER,
            row: 0,
            col: 1,
        });
        expect(getBeginRequestValue()).toMatchObject({
            normalizeIfNeeded: true,
        });
        expect(getOpenRequestValue()).toEqual({ requestId: getBeginRequestValue().requestId });
        expect(getBeginRequestValue()).toMatchObject({
            suppressKeys: true,
        });
        expect(mockDispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                selection: { anchor: 10 },
            })
        );
    });

    it('should navigate next from header end to body start', () => {
        setupTable(1, 2); // 2 cols
        setupActiveCell(SECTION_HEADER, 0, 1); // Last header col

        navigateCell(mockView, 'next');

        expect(getSetActiveCellValue()).toMatchObject({
            section: SECTION_BODY,
            row: 0,
            col: 0,
        });
    });

    it('should navigate next within body', () => {
        setupTable(2, 2);
        setupActiveCell(SECTION_BODY, 0, 1);

        navigateCell(mockView, 'next');

        expect(getSetActiveCellValue()).toMatchObject({
            section: SECTION_BODY,
            row: 1, // Next row
            col: 0, // Wrap to first col
        });
    });

    it('should stop at end of table (next)', () => {
        setupTable(1, 2);
        setupActiveCell(SECTION_BODY, 0, 1); // Last cell in table

        const result = navigateCell(mockView, 'next');

        expect(result).toBe(true);
        expect(mockDispatch).not.toHaveBeenCalled(); // No move
        expect(insertRowAtBottom).not.toHaveBeenCalled();
    });

    it('should add row at end of table with col 0 when Tab (next) with allowRowCreation', () => {
        setupTable(1, 2);
        const resolvedCell = setupActiveCell(SECTION_BODY, 0, 1); // Last cell, col 1
        (insertRowAtBottom as Mock).mockReturnValue(true);

        const result = navigateCell(mockView, 'next', { allowRowCreation: true });
        const openOptions = (insertRowAtBottom as Mock).mock.calls[0][3];

        expect(result).toBe(true);
        expect(insertRowAtBottom).toHaveBeenCalledWith(
            mockView,
            resolvedCell,
            0,
            expect.objectContaining({
                suppressKeys: true,
            })
        );
        expect(openOptions).toEqual(expect.objectContaining({ suppressKeys: true }));
    });

    it('should add row at end of table with same col when Enter (down) with allowRowCreation', () => {
        setupTable(1, 2);
        const resolvedCell = setupActiveCell(SECTION_BODY, 0, 1); // Last row, col 1
        (insertRowAtBottom as Mock).mockReturnValue(true);

        const result = navigateCell(mockView, 'down', { allowRowCreation: true });
        expect(result).toBe(true);
        expect(insertRowAtBottom).toHaveBeenCalledWith(
            mockView,
            resolvedCell,
            1,
            expect.objectContaining({
                suppressKeys: true,
            })
        );
    });

    it('should NOT add row at end of table if allowRowCreation is false', () => {
        setupTable(1, 2);
        setupActiveCell(SECTION_BODY, 0, 1);

        const result = navigateCell(mockView, 'next', { allowRowCreation: false });

        expect(result).toBe(true);
        expect(insertRowAtBottom).not.toHaveBeenCalled();
    });

    it('should not hand off focus when row creation fails', () => {
        setupTable(1, 2);
        setupActiveCell(SECTION_BODY, 0, 1);
        (insertRowAtBottom as Mock).mockReturnValue(false);

        const result = navigateCell(mockView, 'down', { allowRowCreation: true });

        expect(result).toBe(true);
        expect(mockView.focus).not.toHaveBeenCalled();
    });

    it('should navigate previous from body start to header end', () => {
        setupTable(1, 2);
        setupActiveCell(SECTION_BODY, 0, 0);

        navigateCell(mockView, 'previous');

        expect(getSetActiveCellValue()).toMatchObject({
            section: SECTION_HEADER,
            row: 0,
            col: 1, // Last col
        });
    });

    it('should navigate down from header to body', () => {
        setupTable(1, 2);
        setupActiveCell(SECTION_HEADER, 0, 0);

        navigateCell(mockView, 'down');

        expect(getSetActiveCellValue()).toMatchObject({
            section: SECTION_BODY,
            row: 0,
            col: 0,
        });
    });

    it('should navigate up from body to header', () => {
        setupTable(1, 2);
        setupActiveCell(SECTION_BODY, 0, 0);

        navigateCell(mockView, 'up');

        expect(getSetActiveCellValue()).toMatchObject({
            section: SECTION_HEADER,
            row: 0,
            col: 0,
        });
    });

    it('should exit above the table when moving up from the header boundary', () => {
        const ctx = setupTable(2, 2);
        ctx.from = 10;
        ctx.to = 89;
        setupActiveCell(SECTION_HEADER, 0, 1);

        const result = navigateCell(mockView, 'up', { exitTableAtBoundary: true });

        expect(result).toBe(true);
        expect(mockDispatch).toHaveBeenCalledWith(
            expect.objectContaining({ selection: { anchor: 9 }, scrollIntoView: true })
        );
        expect(getEffects().some((effect) => effect.is(clearActiveCellEffect))).toBe(true);
        expect(mockView.focus).toHaveBeenCalled();
    });

    it('should exit below the table when moving down from the final body row', () => {
        const ctx = setupTable(2, 2);
        ctx.from = 10;
        ctx.to = 89;
        setupActiveCell(SECTION_BODY, 1, 0);

        const result = navigateCell(mockView, 'down', { exitTableAtBoundary: true });

        expect(result).toBe(true);
        expect(mockDispatch).toHaveBeenCalledWith(
            expect.objectContaining({ selection: { anchor: 90 }, scrollIntoView: true })
        );
        expect(getEffects().some((effect) => effect.is(clearActiveCellEffect))).toBe(true);
        expect(mockView.focus).toHaveBeenCalled();
    });

    it('should keep boundary navigation blocked when table exit is not requested', () => {
        const ctx = setupTable(1, 2);
        ctx.from = 10;
        ctx.to = 89;
        setupActiveCell(SECTION_HEADER, 0, 0);

        const result = navigateCell(mockView, 'up');

        expect(result).toBe(true);
        expect(mockDispatch).not.toHaveBeenCalled();
        expect(mockView.focus).not.toHaveBeenCalled();
    });

    it('should remain blocked when no adjacent line exists at the document edge', () => {
        const ctx = setupTable(1, 2);
        ctx.from = 0;
        setupActiveCell(SECTION_HEADER, 0, 0);

        const result = navigateCell(mockView, 'up', { exitTableAtBoundary: true });

        expect(result).toBe(true);
        expect(mockDispatch).not.toHaveBeenCalled();
        expect(mockView.focus).not.toHaveBeenCalled();
    });
});

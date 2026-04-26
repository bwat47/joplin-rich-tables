import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { navigateCell } from '../tableRuntime/navigation/tableNavigation';
import { getResolvedActiveCell, resolveCellWithinResolvedTable } from '../tableRuntime/activeCell/resolvedActiveCell';
import { SECTION_BODY, SECTION_HEADER } from '../tableWidget/domHelpers';

import { setActiveCellEffect } from '../tableState/activeCellState';
import { requestOpenCellEffect } from '../tableRuntime/openCellRequest';
import { insertRowAtBottom } from '../tableRuntime/operations/structuralOperations';
import { beginOpenCellRequestEffect } from '../tableRuntime/openCellRequest';

// Mock dependencies (not activeCellState - we need the real StateEffect identity)
jest.mock('../tableRuntime/activeCell/resolvedActiveCell', () => ({
    getResolvedActiveCell: jest.fn(),
    resolveCellWithinResolvedTable: jest.fn(),
}));
jest.mock('../tableRuntime/operations/structuralOperations', () => ({
    __esModule: true,
    insertRowAtBottom: jest.fn(),
}));

describe('navigateCell', () => {
    let mockView: EditorView;
    let mockState: EditorState;
    let mockDispatch: jest.Mock;
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
        mockDispatch = jest.fn();
        currentCtx = null;
        mockState = {
            field: jest.fn(),
            doc: { length: 100 },
        } as unknown as EditorState;

        mockView = {
            state: mockState,
            dispatch: mockDispatch,
            contentDOM: {
                focus: jest.fn(),
                querySelectorAll: jest.fn().mockReturnValue([]),
            },
            dom: {
                querySelector: jest.fn(),
                querySelectorAll: jest.fn().mockReturnValue([]),
            },
            posAtDOM: jest.fn().mockReturnValue(0), // Mock for findCellElement
        } as unknown as EditorView;

        // Reset mocks
        (getResolvedActiveCell as jest.Mock).mockReset();
        (resolveCellWithinResolvedTable as jest.Mock).mockReset();
        (insertRowAtBottom as jest.Mock).mockReset();
    });

    const getEffects = () => {
        const spec = mockDispatch.mock.calls[0]?.[0];
        const effects = spec?.effects;
        return Array.isArray(effects) ? effects : effects ? [effects] : [];
    };

    const getSetActiveCellValue = () => getEffects().find((effect) => effect.is?.(setActiveCellEffect))?.value;
    const getOpenRequestValue = () => getEffects().find((effect) => effect.is?.(requestOpenCellEffect))?.value;
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

        (resolveCellWithinResolvedTable as jest.Mock).mockImplementation((_resolved, target) => ({
            activeCell: {
                tableFrom: 0,
                section: target.section,
                row: target.row,
                col: target.col,
            },
            editableFrom: 10,
            editableTo: 20,
        }));

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

        (getResolvedActiveCell as jest.Mock).mockReturnValue({
            activeCell,
            contentFrom: 10,
            contentTo: 20,
            editableFrom: 10,
            editableTo: 20,
            ctx: currentCtx,
        });
    };

    it('should return false if no active cell', () => {
        (getResolvedActiveCell as jest.Mock).mockReturnValue(null);
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
        setupActiveCell(SECTION_BODY, 0, 1); // Last cell, col 1
        (insertRowAtBottom as jest.Mock).mockReturnValue(true);

        const result = navigateCell(mockView, 'next', { allowRowCreation: true });
        const openOptions = (insertRowAtBottom as jest.Mock).mock.calls[0][3];

        expect(result).toBe(true);
        expect(insertRowAtBottom).toHaveBeenCalledWith(
            mockView,
            expect.anything(),
            0,
            expect.objectContaining({
                suppressKeys: true,
            })
        );
        expect(openOptions).toEqual(expect.objectContaining({ suppressKeys: true }));
    });

    it('should add row at end of table with same col when Enter (down) with allowRowCreation', () => {
        setupTable(1, 2);
        setupActiveCell(SECTION_BODY, 0, 1); // Last row, col 1
        (insertRowAtBottom as jest.Mock).mockReturnValue(true);

        const result = navigateCell(mockView, 'down', { allowRowCreation: true });
        expect(result).toBe(true);
        expect(insertRowAtBottom).toHaveBeenCalledWith(
            mockView,
            expect.anything(),
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
        (insertRowAtBottom as jest.Mock).mockReturnValue(false);

        const result = navigateCell(mockView, 'down', { allowRowCreation: true });

        expect(result).toBe(true);
        expect(mockView.contentDOM.focus).not.toHaveBeenCalled();
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
});

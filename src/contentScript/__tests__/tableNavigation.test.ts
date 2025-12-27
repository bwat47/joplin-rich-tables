import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { navigateCell } from '../tableWidget/tableNavigation';
import { getActiveCell } from '../tableWidget/activeCellState';
import { resolveTableAtPos, resolveCellDocRange } from '../tableWidget/tablePositioning';
import { computeMarkdownTableCellRanges } from '../tableModel/markdownTableCellRanges';
import { SECTION_BODY, SECTION_HEADER } from '../tableWidget/domHelpers';

import * as activeCellState from '../tableWidget/activeCellState';
import { execInsertRowAtBottomAndFocusFirst } from '../tableCommands/tableCommands';

// Mock dependencies (not activeCellState - we need the real StateEffect identity)
jest.mock('../tableWidget/tablePositioning');
jest.mock('../tableModel/markdownTableCellRanges');
jest.mock('../nestedEditor/nestedCellEditor');
jest.mock('../tableCommands/tableCommands', () => ({
    __esModule: true,
    execInsertRowAtBottomAndFocusFirst: jest.fn(),
}));

describe('navigateCell', () => {
    let mockView: EditorView;
    let mockState: EditorState;
    let mockDispatch: jest.Mock;
    let getActiveCellSpy: jest.SpyInstance;

    beforeEach(() => {
        mockDispatch = jest.fn();
        mockState = {
            field: jest.fn(),
            doc: { length: 100 },
        } as unknown as EditorState;

        mockView = {
            state: mockState,
            dispatch: mockDispatch,
            dom: {
                querySelector: jest.fn(),
            },
        } as unknown as EditorView;

        // Reset mocks
        getActiveCellSpy = jest.spyOn(activeCellState, 'getActiveCell');
        getActiveCellSpy.mockReset();
        (resolveTableAtPos as jest.Mock).mockReset();
        (computeMarkdownTableCellRanges as jest.Mock).mockReset();
        (resolveCellDocRange as jest.Mock).mockReset();
        (execInsertRowAtBottomAndFocusFirst as jest.Mock).mockReset();
    });

    const setupTable = (rows: number, cols: number) => {
        // Mock table structure
        (resolveTableAtPos as jest.Mock).mockReturnValue({
            from: 0,
            to: 100,
            text: '| header |\n| --- |\n| body |',
        });

        const headers = Array(cols).fill({});
        const bodyRows = Array(rows).fill(Array(cols).fill({}));

        (computeMarkdownTableCellRanges as jest.Mock).mockReturnValue({
            headers,
            rows: bodyRows,
        });

        // Mock range resolution (always succeeds)
        (resolveCellDocRange as jest.Mock).mockReturnValue({
            cellFrom: 10,
            cellTo: 20,
        });
    };

    const setupActiveCell = (section: 'header' | 'body', row: number, col: number) => {
        getActiveCellSpy.mockReturnValue({
            cellFrom: 10,
            section,
            row,
            col,
        });
    };

    it('should return false if no active cell', () => {
        (getActiveCell as jest.Mock).mockReturnValue(null);
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

        const effect = mockDispatch.mock.calls[0][0].effects;
        expect(effect.value).toMatchObject({
            section: SECTION_HEADER,
            row: 0,
            col: 1,
        });
    });

    it('should navigate next from header end to body start', () => {
        setupTable(1, 2); // 2 cols
        setupActiveCell(SECTION_HEADER, 0, 1); // Last header col

        navigateCell(mockView, 'next');

        const effect = mockDispatch.mock.calls[0][0].effects;
        expect(effect.value).toMatchObject({
            section: SECTION_BODY,
            row: 0,
            col: 0,
        });
    });

    it('should navigate next within body', () => {
        setupTable(2, 2);
        setupActiveCell(SECTION_BODY, 0, 1);

        navigateCell(mockView, 'next');

        const effect = mockDispatch.mock.calls[0][0].effects;
        expect(effect.value).toMatchObject({
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
        expect(execInsertRowAtBottomAndFocusFirst).not.toHaveBeenCalled();
    });

    it('should add row at end of table if allowRowCreation is true', () => {
        setupTable(1, 2);
        setupActiveCell(SECTION_BODY, 0, 1);

        const result = navigateCell(mockView, 'next', { allowRowCreation: true });

        expect(result).toBe(true);
        expect(execInsertRowAtBottomAndFocusFirst).toHaveBeenCalledWith(mockView, expect.anything());
    });

    it('should NOT add row at end of table if allowRowCreation is false', () => {
        setupTable(1, 2);
        setupActiveCell(SECTION_BODY, 0, 1);

        const result = navigateCell(mockView, 'next', { allowRowCreation: false });

        expect(result).toBe(true);
        expect(execInsertRowAtBottomAndFocusFirst).not.toHaveBeenCalled();
    });

    it('should navigate previous from body start to header end', () => {
        setupTable(1, 2);
        setupActiveCell(SECTION_BODY, 0, 0);

        navigateCell(mockView, 'previous');

        const effect = mockDispatch.mock.calls[0][0].effects;
        expect(effect.value).toMatchObject({
            section: SECTION_HEADER,
            row: 0,
            col: 1, // Last col
        });
    });

    it('should navigate down from header to body', () => {
        setupTable(1, 2);
        setupActiveCell(SECTION_HEADER, 0, 0);

        navigateCell(mockView, 'down');

        const effect = mockDispatch.mock.calls[0][0].effects;
        expect(effect.value).toMatchObject({
            section: SECTION_BODY,
            row: 0,
            col: 0,
        });
    });

    it('should navigate up from body to header', () => {
        setupTable(1, 2);
        setupActiveCell(SECTION_BODY, 0, 0);

        navigateCell(mockView, 'up');

        const effect = mockDispatch.mock.calls[0][0].effects;
        expect(effect.value).toMatchObject({
            section: SECTION_HEADER,
            row: 0,
            col: 0,
        });
    });
});

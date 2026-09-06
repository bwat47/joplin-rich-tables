import { describe, expect, it } from 'vitest';
import {
    DATA_COL,
    DATA_ROW,
    DATA_SECTION,
    SECTION_BODY,
    SECTION_HEADER,
    readCellCoords,
} from '../tableWidget/domHelpers';

function createCell(attributes: Partial<Record<string, string>>): HTMLElement {
    const cell = document.createElement('td');
    for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined) {
            cell.dataset[key] = value;
        }
    }
    return cell;
}

describe('readCellCoords', () => {
    it('reads coordinates from a body cell', () => {
        const cell = createCell({ [DATA_SECTION]: SECTION_BODY, [DATA_ROW]: '2', [DATA_COL]: '3' });

        expect(readCellCoords(cell)).toEqual({ section: SECTION_BODY, row: 2, col: 3 });
    });

    it('pins the header row index to 0', () => {
        // The header is a single row, so a stale non-zero data-row must not leak through.
        const cell = createCell({ [DATA_SECTION]: SECTION_HEADER, [DATA_ROW]: '4', [DATA_COL]: '1' });

        expect(readCellCoords(cell)).toEqual({ section: SECTION_HEADER, row: 0, col: 1 });
    });

    it('rejects a section the table widget never writes', () => {
        const cell = createCell({ [DATA_SECTION]: 'footer', [DATA_ROW]: '0', [DATA_COL]: '0' });

        expect(readCellCoords(cell)).toBeNull();
    });

    it('rejects a cell with no data attributes, such as a table nested inside a cell', () => {
        expect(readCellCoords(createCell({}))).toBeNull();
    });

    it('rejects unparseable row and column values', () => {
        const badRow = createCell({ [DATA_SECTION]: SECTION_BODY, [DATA_ROW]: 'x', [DATA_COL]: '0' });
        const badCol = createCell({ [DATA_SECTION]: SECTION_BODY, [DATA_ROW]: '0', [DATA_COL]: 'x' });

        expect(readCellCoords(badRow)).toBeNull();
        expect(readCellCoords(badCol)).toBeNull();
    });
});

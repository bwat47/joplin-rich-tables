import { describe, expect, it } from 'vitest';
import { normalizeCellCoords } from '../tableModel/types';

describe('normalizeCellCoords', () => {
    it('pins a header cell row to 0', () => {
        expect(normalizeCellCoords({ section: 'header', row: 4, col: 1 })).toEqual({
            section: 'header',
            row: 0,
            col: 1,
        });
    });

    it('leaves body coordinates unchanged', () => {
        expect(normalizeCellCoords({ section: 'body', row: 2, col: 3 })).toEqual({
            section: 'body',
            row: 2,
            col: 3,
        });
    });
});

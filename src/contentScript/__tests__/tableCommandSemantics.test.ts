import {
    insertRowForActiveCell,
    deleteRowForActiveCell,
    moveRowForActiveCell,
    moveColumnForActiveCell,
} from '../tableCommands/tableCommandSemantics';
import { TableData } from '../tableModel/markdownTableParsing';
import { ActiveCell } from '../tableWidget/activeCellState';

describe('tableCommandSemantics', () => {
    const basicTable: TableData = {
        headers: ['H1', 'H2'],
        alignments: ['left', 'left'],
        rows: [
            ['R1C1', 'R1C2'],
            ['R2C1', 'R2C2'],
        ],
    };

    const createCell = (section: 'header' | 'body', row: number, col: number): ActiveCell => ({
        tableFrom: 0,
        tableTo: 100,
        cellFrom: 0,
        cellTo: 0,
        section,
        row,
        col,
    });

    describe('insertRowForActiveCell', () => {
        it('should insert row BEFORE header (new header created)', () => {
            const result = insertRowForActiveCell(basicTable, createCell('header', 0, 0), 'before');
            expect(result.headers).toEqual(['', '']); // New empty header
            expect(result.rows[0]).toEqual(['H1', 'H2']); // Old header is now first body row
            expect(result.rows[1]).toEqual(['R1C1', 'R1C2']);
            expect(result.rows.length).toBe(3);
        });

        it('should insert row AFTER header (new first body row)', () => {
            const result = insertRowForActiveCell(basicTable, createCell('header', 0, 0), 'after');
            expect(result.headers).toEqual(['H1', 'H2']);
            expect(result.rows[0]).toEqual(['', '']); // New empty row
            expect(result.rows[1]).toEqual(['R1C1', 'R1C2']);
            expect(result.rows.length).toBe(3);
        });

        it('should insert row BEFORE body row', () => {
            const result = insertRowForActiveCell(basicTable, createCell('body', 1, 0), 'before');
            // Insert before 2nd row (index 1)
            expect(result.rows[0]).toEqual(['R1C1', 'R1C2']);
            expect(result.rows[1]).toEqual(['', '']);
            expect(result.rows[2]).toEqual(['R2C1', 'R2C2']);
        });

        it('should insert row AFTER body row', () => {
            const result = insertRowForActiveCell(basicTable, createCell('body', 1, 0), 'after');
            // Insert after 2nd row (index 1)
            expect(result.rows[1]).toEqual(['R2C1', 'R2C2']);
            expect(result.rows[2]).toEqual(['', '']);
        });
    });

    describe('deleteRowForActiveCell', () => {
        it('should delete header (promote first row)', () => {
            const result = deleteRowForActiveCell(basicTable, createCell('header', 0, 0));
            expect(result.headers).toEqual(['R1C1', 'R1C2']);
            expect(result.rows.length).toBe(1);
            expect(result.rows[0]).toEqual(['R2C1', 'R2C2']);
        });

        it('should NO-OP if deleting header would leave no body rows', () => {
            const littleTable: TableData = {
                headers: ['H'],
                alignments: [null],
                rows: [['OnlyRow']],
            };
            const result = deleteRowForActiveCell(littleTable, createCell('header', 0, 0));
            expect(result).toBe(littleTable);
        });

        it('should delete body row', () => {
            const result = deleteRowForActiveCell(basicTable, createCell('body', 0, 0));
            expect(result.rows.length).toBe(1);
            expect(result.rows[0]).toEqual(['R2C1', 'R2C2']);
        });
    });

    describe('moveRowForActiveCell', () => {
        it('should create NO-OP when moving header UP', () => {
            const result = moveRowForActiveCell(basicTable, createCell('header', 0, 0), 'up');
            expect(result).toBe(basicTable);
        });

        it('should swap header with first body row when moving header DOWN', () => {
            const result = moveRowForActiveCell(basicTable, createCell('header', 0, 0), 'down');
            expect(result.headers).toEqual(['R1C1', 'R1C2']);
            expect(result.rows[0]).toEqual(['H1', 'H2']);
        });

        it('should swap first body row active with header when moving UP', () => {
            const result = moveRowForActiveCell(basicTable, createCell('body', 0, 0), 'up');
            expect(result.headers).toEqual(['R1C1', 'R1C2']);
            expect(result.rows[0]).toEqual(['H1', 'H2']);
        });

        it('should swap body rows', () => {
            const result = moveRowForActiveCell(basicTable, createCell('body', 0, 0), 'down');
            expect(result.rows[0]).toEqual(['R2C1', 'R2C2']);
            expect(result.rows[1]).toEqual(['R1C1', 'R1C2']);
        });
    });

    describe('moveColumnForActiveCell', () => {
        it('should swap columns', () => {
            const result = moveColumnForActiveCell(basicTable, createCell('body', 0, 0), 'right');
            expect(result.headers).toEqual(['H2', 'H1']);
            expect(result.rows[0]).toEqual(['R1C2', 'R1C1']);
        });
    });
});

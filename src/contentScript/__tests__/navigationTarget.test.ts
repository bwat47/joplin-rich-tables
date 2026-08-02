import { resolveNavigationTarget, type NavigationDirection } from '../tableRuntime/navigation/navigationTarget';
import { SECTION_BODY, SECTION_HEADER } from '../tableWidget/domHelpers';
import type { CellCoords, TableGridBounds } from '../tableModel/types';

/** 1 header row + `bodyRows` body rows. */
const gridOf = (bodyRows: number, cols: number): TableGridBounds => ({
    totalRows: 1 + bodyRows,
    totalCols: cols,
});

const header = (col: number): CellCoords => ({ section: SECTION_HEADER, row: 0, col });
const body = (row: number, col: number): CellCoords => ({ section: SECTION_BODY, row, col });

const resolve = (from: CellCoords, direction: NavigationDirection, bounds: TableGridBounds, allowRowCreation = false) =>
    resolveNavigationTarget({ from, bounds, direction, allowRowCreation });

describe('resolveNavigationTarget', () => {
    describe('next', () => {
        it('moves to the following column within the same row', () => {
            expect(resolve(header(0), 'next', gridOf(1, 2))).toEqual({
                kind: 'cell',
                coords: header(1),
            });
        });

        it('wraps from the last header column into the first body cell', () => {
            expect(resolve(header(1), 'next', gridOf(1, 2))).toEqual({
                kind: 'cell',
                coords: body(0, 0),
            });
        });

        it('wraps from the last body column into the next body row', () => {
            expect(resolve(body(0, 1), 'next', gridOf(2, 2))).toEqual({
                kind: 'cell',
                coords: body(1, 0),
            });
        });
    });

    describe('previous', () => {
        it('moves to the preceding column within the same row', () => {
            expect(resolve(body(0, 1), 'previous', gridOf(1, 2))).toEqual({
                kind: 'cell',
                coords: body(0, 0),
            });
        });

        it('wraps from the first body column back to the last header column', () => {
            expect(resolve(body(0, 0), 'previous', gridOf(1, 2))).toEqual({
                kind: 'cell',
                coords: header(1),
            });
        });

        it('blocks at the first header cell instead of wrapping around', () => {
            expect(resolve(header(0), 'previous', gridOf(1, 2))).toEqual({ kind: 'blocked' });
        });
    });

    describe('up and down', () => {
        it('moves down from the header into the body, keeping the column', () => {
            expect(resolve(header(1), 'down', gridOf(1, 2))).toEqual({
                kind: 'cell',
                coords: body(0, 1),
            });
        });

        it('moves up from the body into the header, keeping the column', () => {
            expect(resolve(body(0, 1), 'up', gridOf(1, 2))).toEqual({
                kind: 'cell',
                coords: header(1),
            });
        });

        it('blocks above the header row', () => {
            expect(resolve(header(0), 'up', gridOf(1, 2))).toEqual({ kind: 'blocked' });
        });
    });

    describe('past the last row', () => {
        it('blocks when row creation is not allowed', () => {
            expect(resolve(body(0, 1), 'next', gridOf(1, 2))).toEqual({ kind: 'blocked' });
            expect(resolve(body(0, 1), 'down', gridOf(1, 2))).toEqual({ kind: 'blocked' });
        });

        it('starts a new row at the first column for next (Tab)', () => {
            expect(resolve(body(0, 1), 'next', gridOf(1, 2), true)).toEqual({
                kind: 'newRow',
                targetCol: 0,
            });
        });

        it('keeps the current column for down (Enter)', () => {
            expect(resolve(body(0, 1), 'down', gridOf(1, 2), true)).toEqual({
                kind: 'newRow',
                targetCol: 1,
            });
        });
    });

    it('treats a single-column header-only table as a one-cell grid', () => {
        expect(resolve(header(0), 'next', gridOf(0, 1))).toEqual({ kind: 'blocked' });
        expect(resolve(header(0), 'next', gridOf(0, 1), true)).toEqual({
            kind: 'newRow',
            targetCol: 0,
        });
    });
});

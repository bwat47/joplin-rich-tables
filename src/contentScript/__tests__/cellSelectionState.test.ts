import { EditorState } from '@codemirror/state';
import {
    cellSelectionField,
    clearCellSelectionEffect,
    fromUnifiedRow,
    getCellSelection,
    isCellInRect,
    setCellSelectionEffect,
    toSelectionRect,
    toUnifiedRow,
    type CellSelection,
} from '../tableState/cellSelectionState';
import { activeCellField, setActiveCellEffect } from '../tableState/activeCellState';
import { createMarkdownState } from './testMarkdownState';

const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '| b1 | b2 |'].join('\n');

function createState(): EditorState {
    return createMarkdownState(doc, [activeCellField, cellSelectionField]);
}

function createSelection(): CellSelection {
    return {
        tableFrom: 0,
        anchor: { section: 'body', row: 1, col: 1 },
        focus: { section: 'header', row: 0, col: 0 },
    };
}

describe('cellSelectionState', () => {
    it('normalizes selection rectangles across header and body rows', () => {
        expect(toSelectionRect(createSelection())).toEqual({
            minRow: 0,
            maxRow: 2,
            minCol: 0,
            maxCol: 1,
        });
    });

    it('tests whether a cell is inside a rectangular selection', () => {
        const rect = toSelectionRect(createSelection());

        expect(isCellInRect(rect, { section: 'header', row: 0, col: 1 })).toBe(true);
        expect(isCellInRect(rect, { section: 'body', row: 0, col: 0 })).toBe(true);
        expect(isCellInRect(rect, { section: 'body', row: 1, col: 2 })).toBe(false);
    });

    it('round-trips unified row helpers', () => {
        expect(toUnifiedRow({ section: 'header', row: 0, col: 2 })).toBe(0);
        expect(toUnifiedRow({ section: 'body', row: 2, col: 2 })).toBe(3);
        expect(fromUnifiedRow(0, 1)).toEqual({ section: 'header', row: 0, col: 1 });
        expect(fromUnifiedRow(3, 1)).toEqual({ section: 'body', row: 2, col: 1 });
    });

    it('stores and clears cell selection state via effects', () => {
        let state = createState();
        state = state.update({ effects: setCellSelectionEffect.of(createSelection()) }).state;
        expect(getCellSelection(state)).toEqual(createSelection());

        state = state.update({ effects: clearCellSelectionEffect.of(undefined) }).state;
        expect(getCellSelection(state)).toBeNull();
    });

    it('clears selection when an active cell is set', () => {
        let state = createState();
        state = state.update({ effects: setCellSelectionEffect.of(createSelection()) }).state;

        state = state.update({
            effects: setActiveCellEffect.of({
                anchorPos: doc.indexOf('a1'),
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 0,
            }),
        }).state;

        expect(getCellSelection(state)).toBeNull();
    });

    it('clears selection on document changes', () => {
        let state = createState();
        state = state.update({ effects: setCellSelectionEffect.of(createSelection()) }).state;

        state = state.update({
            changes: { from: doc.length, to: doc.length, insert: '\ntext' },
        }).state;

        expect(getCellSelection(state)).toBeNull();
    });

    it('keeps explicitly-set selection state across the same doc-changing transaction', () => {
        let state = createState();
        const nextSelection = {
            tableFrom: 0,
            anchor: { section: 'header' as const, row: 0, col: 0 },
            focus: { section: 'body' as const, row: 0, col: 1 },
        };

        state = state.update({
            changes: { from: doc.length, to: doc.length, insert: '\ntext' },
            effects: setCellSelectionEffect.of(nextSelection),
        }).state;

        expect(getCellSelection(state)).toEqual(nextSelection);
    });
});

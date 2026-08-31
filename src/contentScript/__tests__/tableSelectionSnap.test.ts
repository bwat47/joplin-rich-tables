import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { activeCellField, setActiveCellEffect } from '../tableState/activeCellState';
import { tableDecorationField, type TableSpan } from '../tableWidget/tableDecorationField';
import { snapSelectionAroundTables, tableSelectionSnapFilter } from '../tableRuntime/selection/tableSelectionSnap';
import { createMarkdownState } from './testMarkdownState';

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
const ABOVE = 'above';
const DOC = `${ABOVE}\n\n${TABLE}\n\nbelow`;
const TABLE_FROM = ABOVE.length + 2;
const TABLE_TO = TABLE_FROM + TABLE.length;
const INSIDE_TABLE = TABLE_FROM + 4;

function createState(): EditorState {
    return createMarkdownState(DOC, [tableDecorationField, sourceModeField, activeCellField, tableSelectionSnapFilter]);
}

function select(state: EditorState, selection: EditorSelection): EditorState {
    return state.update({ selection, userEvent: 'select' }).state;
}

describe('snapSelectionAroundTables', () => {
    const table: TableSpan = { from: 10, to: 20 };
    const findTablesTouching = (from: number, to: number): TableSpan[] =>
        from <= table.to && to >= table.from ? [table] : [];

    it('grows a forward selection ending inside a table to the table end', () => {
        const snapped = snapSelectionAroundTables(EditorSelection.single(5, 15), findTablesTouching);

        expect(snapped?.main).toMatchObject({ anchor: 5, head: 20 });
    });

    it('grows a backward selection ending inside a table to the table start', () => {
        const snapped = snapSelectionAroundTables(EditorSelection.single(25, 15), findTablesTouching);

        expect(snapped?.main).toMatchObject({ anchor: 25, head: 10 });
    });

    it('grows a selection that starts inside a table to the table start', () => {
        const snapped = snapSelectionAroundTables(EditorSelection.single(15, 25), findTablesTouching);

        expect(snapped?.main).toMatchObject({ anchor: 10, head: 25 });
    });

    it('expands a selection contained entirely within a table to the whole table', () => {
        const snapped = snapSelectionAroundTables(EditorSelection.single(12, 16), findTablesTouching);

        expect(snapped?.main).toMatchObject({ anchor: 10, head: 20 });
    });

    it('swallows the table as soon as a selection reaches its near edge', () => {
        expect(snapSelectionAroundTables(EditorSelection.single(5, 10), findTablesTouching)?.main).toMatchObject({
            anchor: 5,
            head: 20,
        });
        expect(snapSelectionAroundTables(EditorSelection.single(25, 20), findTablesTouching)?.main).toMatchObject({
            anchor: 25,
            head: 10,
        });
    });

    it('leaves a selection that already spans the whole table alone', () => {
        expect(snapSelectionAroundTables(EditorSelection.single(5, 25), findTablesTouching)).toBeNull();
        expect(snapSelectionAroundTables(EditorSelection.single(10, 20), findTablesTouching)).toBeNull();
    });

    it('leaves a selection that never reaches the table alone', () => {
        expect(snapSelectionAroundTables(EditorSelection.single(2, 8), findTablesTouching)).toBeNull();
    });

    it('leaves a caret inside a table alone', () => {
        expect(snapSelectionAroundTables(EditorSelection.single(15), findTablesTouching)).toBeNull();
    });

    it('snaps every range of a multi-range selection', () => {
        const snapped = snapSelectionAroundTables(
            EditorSelection.create([EditorSelection.range(0, 2), EditorSelection.range(5, 15)], 1),
            findTablesTouching
        );

        expect(snapped?.ranges.map((range) => [range.from, range.to])).toEqual([
            [0, 2],
            [5, 20],
        ]);
        expect(snapped?.mainIndex).toBe(1);
    });
});

describe('tableSelectionSnapFilter', () => {
    it('grows a selection that stops inside a rendered table', () => {
        const state = select(createState(), EditorSelection.single(0, INSIDE_TABLE));

        expect(state.selection.main).toMatchObject({ anchor: 0, head: TABLE_TO });
    });

    it('grows a selection that only reaches the table start', () => {
        const state = select(createState(), EditorSelection.single(0, TABLE_FROM));

        expect(state.selection.main).toMatchObject({ anchor: 0, head: TABLE_TO });
    });

    it('keeps the user event so other policies still classify the transaction', () => {
        const transaction = createState().update({
            selection: EditorSelection.single(0, INSIDE_TABLE),
            userEvent: 'select.pointer',
        });

        expect(transaction.isUserEvent('select.pointer')).toBe(true);
    });

    it('snaps a selection change that carries no user event', () => {
        const state = createState().update({ selection: EditorSelection.single(0, INSIDE_TABLE) }).state;

        expect(state.selection.main.head).toBe(TABLE_TO);
    });

    it('leaves a selection covering the whole table unchanged', () => {
        const state = select(createState(), EditorSelection.single(0, TABLE_TO));

        expect(state.selection.main).toMatchObject({ anchor: 0, head: TABLE_TO });
    });

    it('ignores selections while a cell editor owns the table', () => {
        const withActiveCell = createState().update({
            effects: setActiveCellEffect.of({
                tableFrom: TABLE_FROM,
                section: 'header',
                row: 0,
                col: 0,
            }),
        }).state;

        const state = select(withActiveCell, EditorSelection.single(INSIDE_TABLE, INSIDE_TABLE + 1));

        expect(state.selection.main).toMatchObject({ anchor: INSIDE_TABLE, head: INSIDE_TABLE + 1 });
    });

    it('ignores selections in raw mode, where the Markdown is the visible text', () => {
        const rawMode = createState().update({ effects: toggleSourceModeEffect.of(true) }).state;

        const state = select(rawMode, EditorSelection.single(0, INSIDE_TABLE));

        expect(state.selection.main.head).toBe(INSIDE_TABLE);
    });

    it('leaves document changes to the editing policies', () => {
        const state = createState().update({
            changes: { from: 0, to: 0, insert: 'x' },
            selection: EditorSelection.single(0, INSIDE_TABLE + 1),
            userEvent: 'select',
        }).state;

        expect(state.selection.main.head).toBe(INSIDE_TABLE + 1);
    });
});

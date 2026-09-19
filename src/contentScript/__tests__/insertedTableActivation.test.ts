import { EditorState } from '@codemirror/state';
import {
    activateInsertedTableEffect,
    getPendingInsertedTableActivation,
    insertedTableActivationField,
} from '../tableState/insertedTableActivation';

const TABLE = ['| H1 |', '| --- |', '| a1 |'].join('\n');
const TARGET = { section: 'header', row: 0, col: 0 } as const;

function createPendingState(doc: string, tableFrom: number): EditorState {
    const state = EditorState.create({ doc, extensions: [insertedTableActivationField] });
    return state.update({ effects: activateInsertedTableEffect.of({ tableFrom, target: TARGET }) }).state;
}

describe('insertedTableActivationField', () => {
    it('maps the pending table start through an insertion before the table', () => {
        const state = createPendingState(TABLE, 0);

        const mapped = state.update({ changes: { from: 0, insert: 'prefix\n' } }).state;

        expect(getPendingInsertedTableActivation(mapped)?.tableFrom).toBe('prefix\n'.length);
    });

    it('drops the pending activation when the table start is deleted', () => {
        const state = createPendingState(TABLE, 0);

        const mapped = state.update({ changes: { from: 0, to: 1 } }).state;

        expect(getPendingInsertedTableActivation(mapped)).toBeNull();
    });

    it('keeps the pending activation when a deletion ends at the table start', () => {
        const prefix = 'prefix\n';
        const state = createPendingState(`${prefix}${TABLE}`, prefix.length);

        const mapped = state.update({ changes: { from: 0, to: prefix.length } }).state;

        expect(getPendingInsertedTableActivation(mapped)?.tableFrom).toBe(0);
    });

    it('drops an anchor past the end of the pre-change document without throwing', () => {
        const state = createPendingState(TABLE, TABLE.length + 1);

        const mapped = state.update({ changes: { from: 0, insert: 'x' } }).state;

        expect(getPendingInsertedTableActivation(mapped)).toBeNull();
    });
});

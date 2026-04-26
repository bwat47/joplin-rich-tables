import { describe, expect, it } from '@jest/globals';
import type { DecorationSet } from '@codemirror/view';
import { searchForceSourceModeField, setSearchForceSourceModeEffect } from '../tableState/searchForceSourceMode';
import { sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { rawTableLineWrappingField } from '../tableWidget/rawTableLineWrapping';
import { createMarkdownState } from './testMarkdownState';

const doc = ['before', '', '| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '', 'after'].join('\n');

function createState() {
    return createMarkdownState(doc, [sourceModeField, searchForceSourceModeField, rawTableLineWrappingField]);
}

function collectDecorationPositions(decorations: DecorationSet): number[] {
    const positions: number[] = [];

    decorations.between(0, doc.length, (from) => {
        positions.push(from);
    });

    return positions;
}

function tableLineStarts(): number[] {
    const state = createState();
    return [state.doc.line(3).from, state.doc.line(4).from, state.doc.line(5).from];
}

describe('rawTableLineWrappingField', () => {
    it('does not decorate table lines when raw mode is off', () => {
        const state = createState();

        expect(collectDecorationPositions(state.field(rawTableLineWrappingField))).toEqual([]);
    });

    it('decorates table source lines when user-controlled source mode is enabled', () => {
        const state = createState().update({
            effects: toggleSourceModeEffect.of(true),
        }).state;

        expect(collectDecorationPositions(state.field(rawTableLineWrappingField))).toEqual(tableLineStarts());
    });

    it('decorates table source lines when search forces source mode', () => {
        const state = createState().update({
            effects: setSearchForceSourceModeEffect.of(true),
        }).state;

        expect(collectDecorationPositions(state.field(rawTableLineWrappingField))).toEqual(tableLineStarts());
    });

    it('does not decorate non-table lines around a raw table', () => {
        const state = createState().update({
            effects: toggleSourceModeEffect.of(true),
        }).state;
        const positions = collectDecorationPositions(state.field(rawTableLineWrappingField));

        expect(positions).not.toContain(state.doc.line(1).from);
        expect(positions).not.toContain(state.doc.line(2).from);
        expect(positions).not.toContain(state.doc.line(6).from);
        expect(positions).not.toContain(state.doc.line(7).from);
    });

    it('clears table line decorations after raw mode is disabled', () => {
        const rawState = createState().update({
            effects: toggleSourceModeEffect.of(true),
        }).state;
        const restoredState = rawState.update({
            effects: toggleSourceModeEffect.of(false),
        }).state;

        expect(collectDecorationPositions(restoredState.field(rawTableLineWrappingField))).toEqual([]);
    });
});

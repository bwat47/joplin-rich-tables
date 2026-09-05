import { describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { activeCellField, setActiveCellEffect } from '../tableState/activeCellState';
import { createMarkdownState } from './testMarkdownState';
import { resolveTableContextFromEventTarget } from '../tableRuntime/tablePositioning';

describe('resolveTableContextFromEventTarget', () => {
    it('uses activeCell.tableFrom as the fallback identity when DOM lookup fails', () => {
        const doc = [
            '| H1 | H2 |',
            '| --- | --- |',
            '| a1 |  |',
            '',
            '|  | Bands |',
            '| --- | :--- |',
            '| **2G:** | `GSM 850 / 900 / 1800 / 1900 CDMA 800` a |',
        ].join('\n');
        let state = createMarkdownState(doc, [activeCellField]);
        state = state.update({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 1,
            }),
        }).state;

        const view = {
            state,
            posAtDOM: () => {
                throw new Error('force active-cell fallback');
            },
        } as unknown as EditorView;

        const target = {
            closest: () => null,
        } as unknown as HTMLElement;

        const context = resolveTableContextFromEventTarget(view, target);

        expect(context).not.toBeNull();
        expect(context?.from).toBe(0);
        expect(context?.table.bodyRows[0][1]).toBe('');
    });
});

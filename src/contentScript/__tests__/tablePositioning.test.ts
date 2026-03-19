import { describe, expect, it } from '@jest/globals';
import { EditorView } from '@codemirror/view';
import { activeCellField, setActiveCellEffect } from '../tableState/activeCellState';
import { createMarkdownState } from './testMarkdownState';
import { resolveTableContextFromEventTarget, trimTrailingNonTableLines } from '../tableRuntime/tablePositioning';

describe('trimTrailingNonTableLines', () => {
    it('returns unchanged text for valid table without trailing content', () => {
        const text = ['| a | b |', '| --- | --- |', '| c | d |'].join('\n');
        expect(trimTrailingNonTableLines(text)).toBe(text);
    });

    it('trims single trailing non-table line', () => {
        const table = ['| a | b |', '| --- | --- |', '| c | d |'].join('\n');
        const input = table + '\ntext-below-table';
        expect(trimTrailingNonTableLines(input)).toBe(table);
    });

    it('trims multiple trailing non-table lines', () => {
        const table = ['| a | b |', '| --- | --- |', '| c | d |'].join('\n');
        const input = table + '\nline1\nline2\nline3';
        expect(trimTrailingNonTableLines(input)).toBe(table);
    });

    it('preserves rows that contain pipe characters', () => {
        const text = ['| a | b |', '| --- | --- |', '| c | d |', 'text | with pipe'].join('\n');
        // Line with pipe is kept (Lezer sees it as a table row)
        expect(trimTrailingNonTableLines(text)).toBe(text);
    });

    it('handles minimal table (header + separator only)', () => {
        const table = ['| a |', '| --- |'].join('\n');
        const input = table + '\ntrailing';
        expect(trimTrailingNonTableLines(input)).toBe(table);
    });

    it('does not trim below minimum table structure', () => {
        // Pathological case: only 2 lines, second lacks pipe
        // We keep both to preserve minimum table structure
        const text = ['| a |', 'not-a-separator'].join('\n');
        expect(trimTrailingNonTableLines(text)).toBe(text);
    });

    it('handles table with multiple body rows and trailing content', () => {
        const table = ['| h1 | h2 |', '| --- | --- |', '| r1c1 | r1c2 |', '| r2c1 | r2c2 |'].join('\n');
        const input = table + '\nsome trailing text';
        expect(trimTrailingNonTableLines(input)).toBe(table);
    });
});

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

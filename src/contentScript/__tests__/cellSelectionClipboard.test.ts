import { createMarkdownState } from './testMarkdownState';
import {
    copySelectionAsMarkdown,
    extractSelectedCellContents,
} from '../tableWidget/cellSelectionClipboard';
import type { CellSelection } from '../tableWidget/cellSelectionState';

const doc = [
    '| H\\|1 | H2 | H3 |',
    '| :--- | ---: | --- |',
    '| a | b\\|c |  |',
    '| x | <br> | z |',
].join('\n');

function selection(anchor: CellSelection['anchor'], focus: CellSelection['focus']): CellSelection {
    return { tableFrom: 0, anchor, focus };
}

describe('cellSelectionClipboard', () => {
    it('extracts header-only selections', () => {
        const state = createMarkdownState(doc);

        expect(
            extractSelectedCellContents(
                state,
                selection({ section: 'header', row: 0, col: 0 }, { section: 'header', row: 0, col: 1 })
            )
        ).toEqual([['H\\|1', 'H2']]);
    });

    it('extracts body-only selections', () => {
        const state = createMarkdownState(doc);

        expect(
            extractSelectedCellContents(
                state,
                selection({ section: 'body', row: 0, col: 1 }, { section: 'body', row: 1, col: 2 })
            )
        ).toEqual([
            ['b\\|c', ''],
            ['<br>', 'z'],
        ]);
    });

    it('extracts selections spanning header and body rows', () => {
        const state = createMarkdownState(doc);

        expect(
            extractSelectedCellContents(
                state,
                selection({ section: 'header', row: 0, col: 1 }, { section: 'body', row: 0, col: 2 })
            )
        ).toEqual([
            ['H2', 'H3'],
            ['b\\|c', ''],
        ]);
    });

    it('serializes selections with original alignments when the header is included', () => {
        const state = createMarkdownState(doc);

        expect(
            copySelectionAsMarkdown(
                state,
                selection({ section: 'header', row: 0, col: 0 }, { section: 'body', row: 1, col: 1 })
            )
        ).toBe(['| H\\|1 | H2 |', '| :--- | ---: |', '| a | b\\|c |', '| x | <br> |'].join('\n'));
    });

    it('serializes body-only selections as a valid standalone markdown table', () => {
        const state = createMarkdownState(doc);

        expect(
            copySelectionAsMarkdown(
                state,
                selection({ section: 'body', row: 0, col: 0 }, { section: 'body', row: 1, col: 1 })
            )
        ).toBe(['| a | b\\|c |', '| --- | --- |', '| x | <br> |'].join('\n'));
    });
});

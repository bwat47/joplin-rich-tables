import { activeCellField, setActiveCellEffect } from '../tableWidget/activeCellState';
import { cellSelectionField, setCellSelectionEffect, type CellSelection } from '../tableWidget/cellSelectionState';
import { createMarkdownState } from './testMarkdownState';
import {
    buildMultiCellPasteRewrite,
    buildSelectionCutRewrite,
    copySelectionAsMarkdown,
    extractSelectedCellContents,
    parseMarkdownTableClipboard,
    resolveTableClipboardTarget,
} from '../tableWidget/cellSelectionClipboard';

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

    it('serializes vertical single-column selections without turning them into a row', () => {
        const state = createMarkdownState(doc);

        expect(
            copySelectionAsMarkdown(
                state,
                selection({ section: 'body', row: 0, col: 0 }, { section: 'body', row: 1, col: 0 })
            )
        ).toBe(['| a |', '| --- |', '| x |'].join('\n'));
    });

    it('parses clipboard markdown into a cell matrix plus alignments', () => {
        expect(parseMarkdownTableClipboard(['| H1 | H2 |', '| :--- | ---: |', '| A1 | A2 |'].join('\n'))).toEqual({
            cells: [
                ['H1', 'H2'],
                ['A1', 'A2'],
            ],
            alignments: ['left', 'right'],
        });
    });

    it('uses the selection top-left cell as the paste anchor', () => {
        let state = createMarkdownState(doc, [cellSelectionField]);
        state = state.update({
            effects: setCellSelectionEffect.of(
                selection({ section: 'body', row: 1, col: 2 }, { section: 'header', row: 0, col: 1 })
            ),
        }).state;

        expect(resolveTableClipboardTarget(state, { nestedEditorOpen: false })).toEqual({
            tableFrom: 0,
            anchor: { section: 'header', row: 0, col: 1 },
            source: 'selection',
        });
    });

    it('uses the active cell as the paste anchor when the nested editor is open', () => {
        let state = createMarkdownState(doc, [activeCellField]);
        state = state.update({
            effects: setActiveCellEffect.of({
                anchorPos: doc.indexOf('b\\|c'),
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 1,
            }),
        }).state;

        expect(resolveTableClipboardTarget(state, { nestedEditorOpen: true })).toEqual({
            tableFrom: 0,
            anchor: { section: 'body', row: 0, col: 1 },
            source: 'activeCell',
        });
    });

    it('returns no anchor when neither a selection nor open nested editor is available', () => {
        const state = createMarkdownState(doc, [activeCellField]);

        expect(resolveTableClipboardTarget(state, { nestedEditorOpen: false })).toBeNull();
    });

    it('builds a cut rewrite that preserves the selected rectangle', () => {
        const state = createMarkdownState(doc);
        const rewrite = buildSelectionCutRewrite(
            state,
            selection({ section: 'header', row: 0, col: 1 }, { section: 'body', row: 1, col: 2 })
        );

        expect(rewrite).not.toBeNull();
        expect(rewrite?.tableText).toBe(['| H\\|1 |  |  |', '| :--- | ---: | --- |', '| a |  |  |', '| x |  |  |'].join('\n'));
        expect(rewrite?.selection).toEqual(
            selection({ section: 'header', row: 0, col: 1 }, { section: 'body', row: 1, col: 2 })
        );
    });

    it('builds a paste rewrite from the selection top-left even when the pasted range is smaller', () => {
        let state = createMarkdownState(doc, [cellSelectionField]);
        state = state.update({
            effects: setCellSelectionEffect.of(
                selection({ section: 'body', row: 1, col: 2 }, { section: 'header', row: 0, col: 1 })
            ),
        }).state;

        const target = resolveTableClipboardTarget(state, { nestedEditorOpen: false });
        const rewrite = buildMultiCellPasteRewrite(
            state,
            target!,
            ['| P1 |', '| --- |', '| Q1 |'].join('\n')
        );

        expect(rewrite).not.toBeNull();
        expect(rewrite?.tableText).toBe(
            ['| H\\|1 | P1 | H3 |', '| :--- | ---: | --- |', '| a | Q1 |  |', '| x | <br> | z |'].join('\n')
        );
        expect(rewrite?.selection).toEqual(
            selection({ section: 'header', row: 0, col: 1 }, { section: 'body', row: 0, col: 1 })
        );
        expect(rewrite?.clearActiveCell).toBe(false);
    });

    it('builds an expanding paste rewrite from the active nested-editor cell', () => {
        let state = createMarkdownState(doc, [activeCellField]);
        state = state.update({
            effects: setActiveCellEffect.of({
                anchorPos: doc.indexOf('b\\|c'),
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 1,
            }),
        }).state;

        const target = resolveTableClipboardTarget(state, { nestedEditorOpen: true });
        const rewrite = buildMultiCellPasteRewrite(
            state,
            target!,
            ['| P1 | P2 | P3 |', '| :--- | ---: | :---: |', '| Q1 | Q2 | Q3 |', '| R1 | R2 | R3 |'].join('\n')
        );

        expect(rewrite).not.toBeNull();
        expect(rewrite?.tableText).toBe(
            [
                '| H\\|1 | H2 | H3 |  |',
                '| :--- | ---: | --- | :---: |',
                '| a | P1 | P2 | P3 |',
                '| x | Q1 | Q2 | Q3 |',
                '|  | R1 | R2 | R3 |',
            ].join('\n')
        );
        expect(rewrite?.selection).toEqual(
            selection({ section: 'body', row: 0, col: 1 }, { section: 'body', row: 2, col: 3 })
        );
        expect(rewrite?.clearActiveCell).toBe(true);
    });

    it('returns null for invalid clipboard markdown', () => {
        const state = createMarkdownState(doc);
        const target = {
            tableFrom: 0,
            anchor: { section: 'body', row: 0, col: 1 } as const,
            source: 'selection' as const,
        };

        expect(buildMultiCellPasteRewrite(state, target, 'plain text')).toBeNull();
    });
});

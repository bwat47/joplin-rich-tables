import { describe, expect, it } from '@jest/globals';
import { activeCellField, getActiveCell, setActiveCellEffect } from '../tableState/activeCellState';
import { cellSelectionField, getCellSelection } from '../tableState/cellSelectionState';
import { activateInsertedTableEffect } from '../tableState/insertedTableActivation';
import { createMainEditorActiveCellGuard } from '../editorBridge/mainEditorGuard';
import { computeMarkdownTableCellRanges } from '../tableModel/markdownTableCellRanges';
import { searchForceSourceModeField, setSearchForceSourceModeEffect } from '../tableState/searchForceSourceMode';
import { sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { createMarkdownState } from './testMarkdownState';

function createState(params: { doc: string; nestedOpen: boolean }) {
    return createMarkdownState(params.doc, [
        activeCellField,
        cellSelectionField,
        searchForceSourceModeField,
        sourceModeField,
        createMainEditorActiveCellGuard(() => params.nestedOpen),
    ]);
}

describe('createMainEditorActiveCellGuard', () => {
    it('blocks deleting a delimiter pipe outside the active cell when nested editor is open', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');

        let state = createState({ doc, nestedOpen: true });
        state = state.update({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'header',
                row: 0,
                col: 0,
            }),
        }).state;

        // Find the delimiter pipe between H1 and H2 on the first line.
        const firstLine = '| H1 | H2 |';
        const pipeIndexInLine = firstLine.indexOf('|', 1 + firstLine.indexOf('H1'));
        expect(pipeIndexInLine).toBeGreaterThan(0);

        const pipePosInDoc = pipeIndexInLine; // table starts at 0

        const tr = state.update({
            changes: { from: pipePosInDoc, to: pipePosInDoc + 1, insert: '' },
        });

        // Transaction should be dropped; doc stays unchanged.
        expect(tr.state.doc.toString()).toBe(doc);
    });

    it('allows deleting within the active cell when nested editor is open', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');

        let state = createState({ doc, nestedOpen: true });
        state = state.update({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'header',
                row: 0,
                col: 0,
            }),
        }).state;

        // Delete the "1" in "H1" (this is inside the trimmed cell range).
        const deleteFrom = doc.indexOf('1');
        expect(deleteFrom).toBeGreaterThan(0);

        const tr = state.update({
            changes: { from: deleteFrom, to: deleteFrom + 1, insert: '' },
        });

        expect(tr.state.doc.toString()).toContain('| H |');
    });

    it('allows structural table edits that force rebuild', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');

        const tableRanges = computeMarkdownTableCellRanges(doc);
        expect(tableRanges).not.toBeNull();

        let state = createState({ doc, nestedOpen: true });
        state = state.update({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'header',
                row: 0,
                col: 0,
            }),
        }).state;

        // Replace the first line (outside cell range) but mark as rebuild, like toolbar does.
        const firstLineEnd = doc.indexOf('\n');
        expect(firstLineEnd).toBeGreaterThan(0);

        const tr = state.update({
            changes: { from: 0, to: firstLineEnd, insert: '| X | Y |' },
            effects: rebuildTableWidgetsEffect.of({ tableFrom: 0 }),
        });

        expect(tr.state.doc.toString()).toContain('| X | Y |');
    });

    it('sanitizes pasted content (newlines/pipes) inside active cell instead of rejecting', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');

        const tableRanges = computeMarkdownTableCellRanges(doc);
        expect(tableRanges).not.toBeNull();

        const cellFrom = tableRanges!.headers[0].from;
        let state = createState({ doc, nestedOpen: true });
        state = state.update({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'header',
                row: 0,
                col: 0,
            }),
        }).state;

        // Simulate pasting "Line1\nLine2|Val" into H1
        const pasteContent = 'Line1\nLine2|Val';
        const expectedContent = 'Line1<br>Line2\\|Val';

        // Insert at start of cell
        const tr = state.update({
            changes: { from: cellFrom, to: cellFrom, insert: pasteContent },
        });

        // The guard should rewrite the changes
        const cellText = tr.state.doc.sliceString(cellFrom, cellFrom + expectedContent.length);
        expect(cellText).toBe(expectedContent);
    });

    it('updates selection correctly when sanitized content length differs from original', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |'].join('\n');
        const tableRanges = computeMarkdownTableCellRanges(doc);
        const cellFrom = tableRanges!.headers[0].from;
        let state = createState({ doc, nestedOpen: true });
        state = state.update({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'header',
                row: 0,
                col: 0,
            }),
            selection: { anchor: cellFrom, head: cellFrom },
        }).state;

        // Paste "a\nb" (length 3). Sanitized "a<br>b" (length 6).
        const pasteContent = 'a\nb';
        const expectedContent = 'a<br>b';

        // 1. Create a transaction interacting with the guard
        const tr = state.update({
            changes: { from: cellFrom, to: cellFrom, insert: pasteContent },
        });

        // 2. The guard intercepts and returns a NEW transaction spec.
        const resultingState = tr.state;
        const resultingSelection = resultingState.selection.main;

        // Original insert was length 3 ("a\nb").
        // Sanitized insert is length 6 ("a<br>b").
        // We expect cursor to be at cellFrom + 6.
        expect(resultingSelection.head).toBe(cellFrom + expectedContent.length);
    });

    it('rewrites markdown-table paste into a multi-cell paste when nested editor paste lands in the main editor', () => {
        const doc = ['| H1 | H2 | H3 |', '| --- | --- | --- |', '| a | b | c |', '| d | e | f |'].join('\n');
        const tableRanges = computeMarkdownTableCellRanges(doc);
        expect(tableRanges).not.toBeNull();

        const bodyCell = tableRanges!.rows[0][1];
        let state = createState({ doc, nestedOpen: true });
        state = state.update({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 1,
            }),
            selection: { anchor: bodyCell.from, head: bodyCell.from },
        }).state;

        const tr = state.update({
            changes: {
                from: bodyCell.from,
                to: bodyCell.from,
                insert: ['| P1 | P2 |', '| :--- | ---: |', '| Q1 | Q2 |'].join('\n'),
            },
            userEvent: 'input.paste',
        });

        expect(tr.state.doc.toString()).toBe(
            ['| H1 | H2 | H3 |', '| --- | --- | --- |', '| a | P1 | P2 |', '| d | Q1 | Q2 |'].join('\n')
        );
        expect(getActiveCell(tr.state)).toBeNull();
        expect(getCellSelection(tr.state)).toEqual({
            tableFrom: 0,
            anchor: { section: 'body', row: 0, col: 1 },
            focus: { section: 'body', row: 1, col: 2 },
        });
    });

    it('rewrites plain root markdown-table paste into canonical table text and activation effect', () => {
        const state = createState({
            doc: ['before', '', 'after'].join('\n'),
            nestedOpen: false,
        });
        const pasteText = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');
        const pastePos = 'before\n'.length;

        const tr = state.update({
            changes: {
                from: pastePos,
                to: pastePos,
                insert: pasteText,
            },
            selection: { anchor: pastePos },
            userEvent: 'input.paste',
        });

        expect(tr.state.doc.toString()).toBe(
            ['before', '', '| H1 | H2 |', '| --- | --- |', '| a | b |', '', 'after'].join('\n')
        );
        expect(tr.state.selection.main.head).toBe(8);
        expect(tr.effects.some((effect) => effect.is(activateInsertedTableEffect))).toBe(true);
        expect(getActiveCell(tr.state)).toBeNull();
        expect(getCellSelection(tr.state)).toBeNull();
    });

    it('leaves non-table paste unchanged in the plain root editor', () => {
        const state = createState({ doc: '', nestedOpen: false });

        const tr = state.update({
            changes: { from: 0, to: 0, insert: 'plain text' },
            userEvent: 'input.paste',
        });

        expect(tr.state.doc.toString()).toBe('plain text');
        expect(tr.effects.some((effect) => effect.is(activateInsertedTableEffect))).toBe(false);
    });

    it('rewrites plain root markdown-table paste in an empty document with surrounding newlines', () => {
        const state = createState({ doc: '', nestedOpen: false });
        const pasteText = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');

        const tr = state.update({
            changes: { from: 0, to: 0, insert: pasteText },
            userEvent: 'input.paste',
        });

        expect(tr.state.doc.toString()).toBe(`\n${['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n')}\n`);
        expect(tr.state.selection.main.head).toBe(1);
        expect(tr.effects.some((effect) => effect.is(activateInsertedTableEffect))).toBe(true);
    });

    it('leaves mid-line table paste unchanged in the plain root editor', () => {
        const doc = 'before after';
        const state = createState({ doc, nestedOpen: false });
        const pasteText = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');
        const pastePos = doc.indexOf(' ');

        const tr = state.update({
            changes: { from: pastePos, to: pastePos, insert: pasteText },
            userEvent: 'input.paste',
        });

        expect(tr.state.doc.toString()).toBe(`before${pasteText} after`);
        expect(tr.effects.some((effect) => effect.is(activateInsertedTableEffect))).toBe(false);
    });

    it('leaves table paste unchanged in source mode', () => {
        let state = createState({ doc: '', nestedOpen: false });
        state = state.update({ effects: toggleSourceModeEffect.of(true) }).state;
        const pasteText = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');

        const tr = state.update({
            changes: { from: 0, to: 0, insert: pasteText },
            userEvent: 'input.paste',
        });

        expect(tr.state.doc.toString()).toBe(pasteText);
        expect(tr.effects.some((effect) => effect.is(activateInsertedTableEffect))).toBe(false);
    });

    it('leaves table paste unchanged when search forces raw mode', () => {
        let state = createState({
            doc: ['before', '', 'after'].join('\n'),
            nestedOpen: false,
        });
        state = state.update({ effects: setSearchForceSourceModeEffect.of(true) }).state;
        const pasteText = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');
        const pastePos = 'before\n'.length;

        const tr = state.update({
            changes: { from: pastePos, to: pastePos, insert: pasteText },
            userEvent: 'input.paste',
        });

        expect(tr.state.doc.toString()).toBe(`before\n${pasteText}\nafter`);
        expect(tr.effects.some((effect) => effect.is(activateInsertedTableEffect))).toBe(false);
    });

    it('allows full document replacement and clears active cell', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        const tableRanges = computeMarkdownTableCellRanges(doc);
        expect(tableRanges).not.toBeNull();

        let state = createState({ doc, nestedOpen: true });
        state = state.update({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'header',
                row: 0,
                col: 0,
            }),
        }).state;

        const newDoc = '# Updated\n\nNo tables here.';

        const tr = state.update({
            changes: { from: 0, to: doc.length, insert: newDoc },
        });

        expect(tr.state.doc.toString()).toBe(newDoc);
        expect(getActiveCell(tr.state)).toBeNull();
    });

    it('clears stale active cell when the resolver cannot find the anchored table', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');
        let state = createState({ doc, nestedOpen: true });
        state = state.update({
            effects: setActiveCellEffect.of({
                tableFrom: doc.length + 10,
                section: 'header',
                row: 0,
                col: 0,
            }),
        }).state;

        const tr = state.update({
            changes: { from: 0, to: 0, insert: 'x' },
        });

        expect(getActiveCell(tr.state)).toBeNull();
        expect(tr.state.doc.toString()).toBe(`x${doc}`);
    });
});

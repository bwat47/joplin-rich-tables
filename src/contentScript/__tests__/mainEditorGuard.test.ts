import { describe, expect, it } from 'vitest';
import { activeCellField, getActiveCell, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { cellSelectionField, getCellSelection } from '../tableState/cellSelectionState';
import { activateInsertedTableEffect, insertedTableActivationField } from '../tableState/insertedTableActivation';
import { createMainEditorActiveCellGuard } from '../editorBridge/mainEditorGuard';
import {
    buildMultiCellPasteRewrite,
    createTableClipboardRewriteSpec,
} from '../tableRuntime/selection/cellSelectionClipboard';
import { searchForceSourceModeField, setSearchForceSourceModeEffect } from '../tableState/searchForceSourceMode';
import { sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { createMarkdownState } from './testMarkdownState';
import { parseCellRangesFixture } from './testUtils';

const TABLE_DOC = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');

function createState(params: { doc: string; nestedOpen: boolean }) {
    return createMarkdownState(params.doc, [
        activeCellField,
        cellSelectionField,
        searchForceSourceModeField,
        sourceModeField,
        insertedTableActivationField,
        createMainEditorActiveCellGuard(() => params.nestedOpen),
    ]);
}

function headerCell(overrides: Partial<ActiveCell> = {}): ActiveCell {
    return {
        tableFrom: 0,
        section: 'header',
        row: 0,
        col: 0,
        ...overrides,
    };
}

function createActiveHeaderState(params?: {
    doc?: string;
    activeCell?: ActiveCell;
    selection?: { anchor: number; head?: number };
}) {
    let state = createState({ doc: params?.doc ?? TABLE_DOC, nestedOpen: true });
    state = state.update({
        effects: setActiveCellEffect.of(params?.activeCell ?? headerCell()),
        selection: params?.selection,
    }).state;

    return state;
}

describe('createMainEditorActiveCellGuard', () => {
    it('blocks deleting a delimiter pipe outside the active cell when nested editor is open', () => {
        const doc = TABLE_DOC;
        const state = createActiveHeaderState();

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
        const doc = TABLE_DOC;
        const state = createActiveHeaderState();

        // Delete the "1" in "H1" (this is inside the trimmed cell range).
        const deleteFrom = doc.indexOf('1');
        expect(deleteFrom).toBeGreaterThan(0);

        const tr = state.update({
            changes: { from: deleteFrom, to: deleteFrom + 1, insert: '' },
        });

        expect(tr.state.doc.toString()).toContain('| H |');
    });

    it('applies a table clipboard rewrite dispatched while the nested editor is open', () => {
        // The document-level clipboard capture dispatches this rewrite straight at the main
        // editor. It replaces the whole table, so without a guard bypass the active-cell
        // sanitization would reject it and the paste would silently do nothing.
        const state = createActiveHeaderState();
        const rewrite = buildMultiCellPasteRewrite(
            state,
            { tableFrom: 0, anchor: { section: 'header', row: 0, col: 0 }, source: 'activeCell' },
            ['| P1 | P2 |', '| --- | --- |', '| Q1 | Q2 |'].join('\n')
        );
        expect(rewrite).not.toBeNull();

        const tr = state.update(createTableClipboardRewriteSpec(state, rewrite!));

        expect(tr.state.doc.toString()).toBe(['| P1 | P2 |', '| --- | --- |', '| Q1 | Q2 |'].join('\n'));
        expect(getActiveCell(tr.state)).toBeNull();
        expect(getCellSelection(tr.state)).not.toBeNull();
    });

    it('allows structural table edits that force rebuild', () => {
        const doc = TABLE_DOC;

        const state = createActiveHeaderState();

        // Replace the first line (outside cell range) but mark as rebuild, like toolbar does.
        const firstLineEnd = doc.indexOf('\n');
        expect(firstLineEnd).toBeGreaterThan(0);

        const tr = state.update({
            changes: { from: 0, to: firstLineEnd, insert: '| X | Y |' },
            effects: rebuildTableWidgetsEffect.of(undefined),
        });

        expect(tr.state.doc.toString()).toContain('| X | Y |');
    });

    it('sanitizes pasted content (newlines/pipes) inside active cell instead of rejecting', () => {
        const doc = TABLE_DOC;

        const tableRanges = parseCellRangesFixture(doc);

        const cellFrom = tableRanges.headers[0].from;
        const state = createActiveHeaderState();

        // Simulate pasting "Line1\nLine2|Val" into H1
        const pasteContent = 'Line1\nLine2|Val';
        const expectedContent = String.raw`Line1<br>Line2\|Val`;

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
        const tableRanges = parseCellRangesFixture(doc);
        const cellFrom = tableRanges.headers[0].from;
        const state = createActiveHeaderState({
            doc,
            selection: { anchor: cellFrom, head: cellFrom },
        });

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
        const tableRanges = parseCellRangesFixture(doc);

        const bodyCell = tableRanges.rows[0][1];
        const state = createActiveHeaderState({
            doc,
            activeCell: headerCell({
                section: 'body',
                row: 0,
                col: 1,
            }),
            selection: { anchor: bodyCell.from, head: bodyCell.from },
        });

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

    it('does not rewrite nested-editor table paste when the active cell no longer resolves', () => {
        const doc = ['| H1 | H2 | H3 |', '| --- | --- | --- |', '| a | b | c |', '| d | e | f |'].join('\n');
        const state = createActiveHeaderState({
            doc,
            activeCell: headerCell({
                section: 'body',
                row: 0,
                col: 99,
            }),
        });

        const pasteText = ['| P1 | P2 |', '| --- | --- |', '| Q1 | Q2 |'].join('\n');
        const tr = state.update({
            changes: {
                from: 0,
                to: 0,
                insert: pasteText,
            },
            userEvent: 'input.paste',
        });

        expect(tr.state.doc.toString()).toBe(`${pasteText}${doc}`);
        expect(getActiveCell(tr.state)).toBeNull();
        expect(getCellSelection(tr.state)).toBeNull();
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

    it('leaves multiple blank-line-separated tables unchanged in the plain root editor', () => {
        const state = createState({ doc: '', nestedOpen: false });
        const pasteText = [
            '| h2 | h2 |',
            '| --- | --- |',
            '| t1 | t2 |',
            '',
            '| col1 | col2 |',
            '| --- | --- |',
            '| t3 | t4 |',
        ].join('\n');

        const tr = state.update({
            changes: { from: 0, to: 0, insert: pasteText },
            userEvent: 'input.paste',
        });

        expect(tr.state.doc.toString()).toBe(pasteText);
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

    it('rewrites mid-line table paste with canonical spacing and activation effect', () => {
        const doc = 'before after';
        const state = createState({ doc, nestedOpen: false });
        const pasteText = ['|H1|H2|', '|---|---|', '|a|b|'].join('\n');
        const pastePos = doc.indexOf(' ');

        const tr = state.update({
            changes: { from: pastePos, to: pastePos, insert: pasteText },
            userEvent: 'input.paste',
        });

        expect(tr.state.doc.toString()).toBe(
            `before\n\n${['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n')}\n\n after`
        );
        expect(tr.state.selection.main.head).toBe(pastePos + 2);
        expect(tr.effects.some((effect) => effect.is(activateInsertedTableEffect))).toBe(true);
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
        const doc = TABLE_DOC;
        const state = createActiveHeaderState();

        const newDoc = '# Updated\n\nNo tables here.';

        const tr = state.update({
            changes: { from: 0, to: doc.length, insert: newDoc },
        });

        expect(tr.state.doc.toString()).toBe(newDoc);
        expect(getActiveCell(tr.state)).toBeNull();
    });

    it('clears stale active cell when the resolver cannot find the anchored table', () => {
        // The anchor must stay inside the document so `activeCellField` keeps it through the
        // change; an out-of-document anchor is dropped by the field itself and never reaches
        // the guard. Anchoring into a paragraph is what an active cell looks like after the
        // table it pointed at is gone.
        const doc = `${TABLE_DOC}\n\nparagraph`;
        const state = createActiveHeaderState({
            doc,
            activeCell: headerCell({
                tableFrom: doc.indexOf('paragraph'),
            }),
        });

        const tr = state.update({
            changes: { from: 0, to: 0, insert: 'x' },
        });

        expect(getActiveCell(tr.state)).toBeNull();
        expect(tr.state.doc.toString()).toBe(`x${doc}`);
    });
});

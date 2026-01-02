import { describe, expect, it } from '@jest/globals';
import { EditorState } from '@codemirror/state';
import { activeCellField, setActiveCellEffect } from '../tableWidget/activeCellState';
import { computeMarkdownTableCellRanges } from '../tableModel/markdownTableCellRanges';
import { createMainEditorActiveCellGuard } from '../nestedEditor/mainEditorGuard';
import { rebuildTableWidgetsEffect } from '../tableWidget/tableWidgetEffects';

function createState(params: { doc: string; nestedOpen: boolean }) {
    return EditorState.create({
        doc: params.doc,
        extensions: [activeCellField, createMainEditorActiveCellGuard(() => params.nestedOpen)],
    });
}

describe('createMainEditorActiveCellGuard', () => {
    it('blocks deleting a delimiter pipe outside the active cell when nested editor is open', () => {
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');

        const tableRanges = computeMarkdownTableCellRanges(doc);
        expect(tableRanges).not.toBeNull();

        // Active cell: header col 0 ("H1")
        const cellFrom = tableRanges!.headers[0].from;
        const cellTo = tableRanges!.headers[0].to;

        let state = createState({ doc, nestedOpen: true });
        state = state.update({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                tableTo: doc.length,
                cellFrom,
                cellTo,
                section: 'header',
                row: 0,
                col: 0,
                editedSinceActivation: false,
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

        const tableRanges = computeMarkdownTableCellRanges(doc);
        expect(tableRanges).not.toBeNull();

        const cellFrom = tableRanges!.headers[0].from;
        const cellTo = tableRanges!.headers[0].to;

        let state = createState({ doc, nestedOpen: true });
        state = state.update({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                tableTo: doc.length,
                cellFrom,
                cellTo,
                section: 'header',
                row: 0,
                col: 0,
                editedSinceActivation: false,
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

        const cellFrom = tableRanges!.headers[0].from;
        const cellTo = tableRanges!.headers[0].to;

        let state = createState({ doc, nestedOpen: true });
        state = state.update({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                tableTo: doc.length,
                cellFrom,
                cellTo,
                section: 'header',
                row: 0,
                col: 0,
                editedSinceActivation: false,
            }),
        }).state;

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
        const doc = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n');

        const tableRanges = computeMarkdownTableCellRanges(doc);
        expect(tableRanges).not.toBeNull();

        const cellFrom = tableRanges!.headers[0].from;
        const cellTo = tableRanges!.headers[0].to;

        let state = createState({ doc, nestedOpen: true });
        state = state.update({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                tableTo: doc.length,
                cellFrom,
                cellTo,
                section: 'header',
                row: 0,
                col: 0,
                editedSinceActivation: false,
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
        const cellTo = tableRanges!.headers[0].to;

        let state = createState({ doc, nestedOpen: true });
        state = state.update({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                tableTo: doc.length,
                cellFrom,
                cellTo,
                section: 'header',
                row: 0,
                col: 0,
                editedSinceActivation: false,
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
});

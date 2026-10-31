import { EditorSelection, type Extension } from '@codemirror/state';
import { Direction, type EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tableBoundaryDeletionExtension } from '../tableRuntime/boundaries/tableBoundaryDeletion';
import { mainEditorTableEntryExtension } from '../tableRuntime/navigation/mainEditorTableEntry';
import { getActiveCell } from '../tableState/activeCellState';
import { getPendingOpenCellRequest } from '../tableState/openCellRequestState';
import { pressKey } from './tableEditorFixtures';
import {
    createTableEntryTestHarness,
    currentTableFrom,
    expectBoundaryCellOpen,
    expectCellOpen,
    RAW_MODE_CASES,
    TABLE,
} from './tableEntryFixtures';

const harness = createTableEntryTestHarness();

beforeEach(() => harness.install());
afterEach(() => harness.cleanup());

function mountView(
    doc: string,
    selection: number | { anchor: number; head: number },
    extraExtensions: Extension[] = []
): EditorView {
    return harness.mountView(doc, selection, [...extraExtensions, mainEditorTableEntryExtension]);
}

function mockVerticalTarget(view: EditorView, targetPos: number): void {
    vi.spyOn(view, 'moveVertically').mockReturnValue(EditorSelection.cursor(targetPos));
}

describe('mainEditorTableEntry vertical movement', () => {
    it('opens the top-left header cell when ArrowDown skips across the table widget', () => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}\n\nbelow`;
        const view = mountView(doc, prefix.length);
        mockVerticalTarget(view, doc.indexOf('below'));

        pressKey(view.contentDOM, { key: 'ArrowDown' });

        // The fixture table has no blank line above it, so entry normalizes as it opens.
        expect(view.state.doc.toString()).toBe(`${prefix}\n\n${TABLE}\n\nbelow`);
        expect(getActiveCell(view.state)).toEqual({
            tableFrom: currentTableFrom(view),
            section: 'header',
            row: 0,
            col: 0,
        });
        expect(getPendingOpenCellRequest(view.state)).toMatchObject({
            initialCursorPos: 'start',
        });
    });

    it('opens the bottom-left body cell when ArrowUp skips across the table widget', () => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}\n\nbelow`;
        const view = mountView(doc, prefix.length + 1 + TABLE.length + 1);
        mockVerticalTarget(view, prefix.length);

        pressKey(view.contentDOM, { key: 'ArrowUp' });

        expect(getActiveCell(view.state)).toEqual({
            tableFrom: currentTableFrom(view),
            section: 'body',
            row: 1,
            col: 0,
        });
        expect(getPendingOpenCellRequest(view.state)).toMatchObject({
            initialCursorPos: 'lastLineStart',
        });
    });

    it('opens the header when ArrowUp enters a table with no body rows', () => {
        const headerOnlyTable = ['| H1 | H2 |', '| --- | --- |'].join('\n');
        const doc = `${headerOnlyTable}\n\nbelow`;
        const view = mountView(doc, doc.indexOf('below'));
        mockVerticalTarget(view, headerOnlyTable.length);

        pressKey(view.contentDOM, { key: 'ArrowUp' });

        expect(getActiveCell(view.state)).toEqual({
            tableFrom: currentTableFrom(view, headerOnlyTable),
            section: 'header',
            row: 0,
            col: 0,
        });
        expect(getPendingOpenCellRequest(view.state)).toMatchObject({
            initialCursorPos: 'lastLineStart',
        });
    });

    it.each(RAW_MODE_CASES)('leaves vertical movement in the main editor during $label', ({ enterRawMode }) => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);
        enterRawMode(view);
        mockVerticalTarget(view, prefix.length + 1);

        pressKey(view.contentDOM, { key: 'ArrowDown' });

        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('does not activate a table when vertical movement stays outside it', () => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);
        mockVerticalTarget(view, prefix.length - 1);

        pressKey(view.contentDOM, { key: 'ArrowDown' });

        expect(getActiveCell(view.state)).toBeNull();
    });

    it('requires entry from the side implied by the arrow direction', () => {
        const doc = `${TABLE}\nbelow`;
        const view = mountView(doc, TABLE.length + 1);
        mockVerticalTarget(view, TABLE.length);

        pressKey(view.contentDOM, { key: 'ArrowDown' });

        expect(getActiveCell(view.state)).toBeNull();
    });

    it('does not enter the table below when the movement stays inside a wrapped line', () => {
        const wrappedLine = 'a fairly long paragraph that wraps across several visual lines';
        const doc = `${wrappedLine}\n${TABLE}`;
        const view = mountView(doc, 2);
        // A wrapped-line step lands further along the same line block, still short of the table.
        mockVerticalTarget(view, 20);

        pressKey(view.contentDOM, { key: 'ArrowDown' });

        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('does not enter a table when the movement lands on an ordinary neighbouring line', () => {
        const doc = `above\nmiddle\n${TABLE}`;
        const view = mountView(doc, 5);
        mockVerticalTarget(view, 8);

        pressKey(view.contentDOM, { key: 'ArrowDown' });

        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('does not intercept a non-collapsed vertical selection', () => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, { anchor: 0, head: prefix.length });
        mockVerticalTarget(view, prefix.length + 1);

        pressKey(view.contentDOM, { key: 'ArrowDown' });

        expect(getActiveCell(view.state)).toBeNull();
    });

    it('leaves Shift+ArrowDown to the main editor', () => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);
        mockVerticalTarget(view, prefix.length + 1);

        pressKey(view.contentDOM, { key: 'ArrowDown', shiftKey: true });

        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });
});

describe('mainEditorTableEntry horizontal movement', () => {
    it('opens the first cell when ArrowRight crosses from the empty line above the table', () => {
        const prefix = 'above\n';
        const doc = `${prefix}\n${TABLE}`;
        const tableFrom = prefix.length + 1;
        const view = mountView(doc, prefix.length);

        pressKey(view.contentDOM, { key: 'ArrowRight' });

        expectCellOpen(view, { tableFrom, section: 'header', row: 0, col: 0 }, 'start');
    });

    it('opens the final cell when ArrowLeft crosses from the empty line below the table', () => {
        const doc = `${TABLE}\n\nbelow`;
        const view = mountView(doc, TABLE.length + 1);

        pressKey(view.contentDOM, { key: 'ArrowLeft' });

        expectCellOpen(view, { tableFrom: currentTableFrom(view), section: 'body', row: 1, col: 1 }, 'end');
    });

    it('leaves ordinary horizontal movement to the main editor', () => {
        const doc = `above\n\n${TABLE}`;
        const view = mountView(doc, 1);

        pressKey(view.contentDOM, { key: 'ArrowRight' });

        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
        expect(view.state.selection.main.head).toBe(2);
    });

    it('leaves Shift+ArrowRight to the main editor', () => {
        const prefix = 'above\n';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);

        pressKey(view.contentDOM, { key: 'ArrowRight', shiftKey: true });

        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('uses the line text direction to interpret horizontal movement', () => {
        const prefix = 'above\n';
        const doc = `${prefix}\n${TABLE}`;
        const tableFrom = prefix.length + 1;
        const view = mountView(doc, prefix.length);
        vi.spyOn(view, 'textDirectionAt').mockReturnValue(Direction.RTL);
        vi.spyOn(view, 'moveByChar').mockReturnValue(EditorSelection.cursor(tableFrom));

        pressKey(view.contentDOM, { key: 'ArrowLeft' });

        expectCellOpen(view, { tableFrom, section: 'header', row: 0, col: 0 }, 'start');
    });
});

describe('mainEditorTableEntry key repeat', () => {
    it('pins the caret when ArrowRight repeats while the entry request is in flight', () => {
        const prefix = 'above\n';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);

        pressKey(view.contentDOM, { key: 'ArrowRight' });
        const headAfterEntry = view.state.selection.main.head;
        pressKey(view.contentDOM, { key: 'ArrowRight' });
        pressKey(view.contentDOM, { key: 'ArrowRight' });

        expect(view.state.selection.main.head).toBe(headAfterEntry);
        expectCellOpen(view, { tableFrom: prefix.length + 1, section: 'header', row: 0, col: 0 }, 'start');
    });

    it('pins the caret when ArrowDown repeats while the entry request is in flight', () => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);
        mockVerticalTarget(view, prefix.length + 1);

        pressKey(view.contentDOM, { key: 'ArrowDown' });
        const headAfterEntry = view.state.selection.main.head;
        pressKey(view.contentDOM, { key: 'ArrowDown' });

        expect(view.state.selection.main.head).toBe(headAfterEntry);
        expectCellOpen(view, { tableFrom: currentTableFrom(view), section: 'header', row: 0, col: 0 }, 'start');
    });

    it('pins the caret when an arrow follows a deletion that entered the table', () => {
        const doc = `${TABLE}\n\nbelow`;
        // The deletion filter opens the cell, so the arrow keys are pinned by the open-cell request.
        const view = mountView(doc, TABLE.length + 2, [tableBoundaryDeletionExtension]);

        pressKey(view.contentDOM, { key: 'Backspace' });
        pressKey(view.contentDOM, { key: 'Backspace' });
        const headAfterEntry = view.state.selection.main.head;
        pressKey(view.contentDOM, { key: 'ArrowRight' });
        pressKey(view.contentDOM, { key: 'ArrowRight' });

        expect(view.state.selection.main.head).toBe(headAfterEntry);
        expectBoundaryCellOpen(view, 'end');
    });

    it('leaves arrow keys to the main editor when no request is in flight', () => {
        const doc = `above\n\n${TABLE}`;
        const view = mountView(doc, 0);

        pressKey(view.contentDOM, { key: 'ArrowRight' });
        pressKey(view.contentDOM, { key: 'ArrowRight' });

        expect(view.state.selection.main.head).toBe(2);
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });
});

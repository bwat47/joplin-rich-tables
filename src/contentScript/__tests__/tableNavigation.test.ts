import type { EditorView } from '@codemirror/view';
import { navigateCell } from '../tableRuntime/navigation/tableNavigation';
import { beginOpenCellRequestEffect, getPendingOpenCellRequest } from '../tableRuntime/openCellRequest';
import { getActiveCell, type ActiveCell } from '../tableState/activeCellState';
import { SECTION_BODY, SECTION_HEADER } from '../tableWidget/domHelpers';
import { createInteractiveTableHarness, type MutableTestView } from './interactiveTableTestHarness';

/**
 * Blank lines fence the table off from the surrounding prose: without them the Markdown
 * parser reads the adjacent line as a ragged table row. The table is already canonical, so
 * entry finds nothing to repair and every document assertion below is about navigation.
 */
const TABLE_LINES = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '| b1 | b2 |'];
const DOC = ['before', '', ...TABLE_LINES, '', 'after'].join('\n');
const TABLE_FROM = DOC.indexOf(TABLE_LINES[0]);
const TABLE_TO = TABLE_FROM + TABLE_LINES.join('\n').length;
const DOC_WITH_APPENDED_ROW = ['before', '', ...TABLE_LINES, '|  |  |', '', 'after'].join('\n');

/** `exitTableToAdjacentLine` leaves through the character just outside the table span. */
const EXIT_BEFORE_ANCHOR = TABLE_FROM - 1;
const EXIT_AFTER_ANCHOR = TABLE_TO + 1;

/** A table flush against the start of the document, so exiting before it has nowhere to go. */
const DOC_AT_START = [...TABLE_LINES, '', 'after'].join('\n');

function activeCellAt(section: 'header' | 'body', row: number, col: number, tableFrom = TABLE_FROM): ActiveCell {
    return { tableFrom, section, row, col };
}

function openHarness(params: { doc?: string; activeCell?: ActiveCell }): {
    view: EditorView;
    focus: MutableTestView['focus'];
} {
    const { view } = createInteractiveTableHarness({
        doc: params.doc ?? DOC,
        activeCell: params.activeCell,
    });

    return { view, focus: (view as unknown as MutableTestView).focus };
}

describe('navigateCell', () => {
    it('reports the keypress unhandled when no cell is active', () => {
        const { view } = openHarness({});

        expect(navigateCell(view, 'next')).toBe(false);
    });

    it('swallows the keypress while an open-cell request is still suppressing navigation', () => {
        const { view } = openHarness({ activeCell: activeCellAt(SECTION_HEADER, 0, 0) });
        view.dispatch({
            effects: beginOpenCellRequestEffect.of({
                requestId: 'pending-open',
                activeCell: activeCellAt(SECTION_HEADER, 0, 1),
                suppressKeys: true,
            }),
        });

        expect(navigateCell(view, 'next')).toBe(true);
        expect(getActiveCell(view.state)).toMatchObject({ section: SECTION_HEADER, row: 0, col: 0 });
    });

    it('opens the next cell and pends the request that reopens it', () => {
        const { view } = openHarness({ activeCell: activeCellAt(SECTION_HEADER, 0, 0) });

        expect(navigateCell(view, 'next', { initialCursorPos: 'end' })).toBe(true);

        const activeCell = getActiveCell(view.state);
        expect(activeCell).toMatchObject({ section: SECTION_HEADER, row: 0, col: 1 });
        expect(view.state.selection.main.anchor).toBe(DOC.indexOf('H2'));
        expect(getPendingOpenCellRequest(view.state)).toMatchObject({
            activeCell,
            initialCursorPos: 'end',
            suppressKeys: true,
        });
    });

    it('stops at the last cell rather than creating a row', () => {
        const { view } = openHarness({ activeCell: activeCellAt(SECTION_BODY, 1, 1) });

        expect(navigateCell(view, 'next')).toBe(true);
        expect(view.state.doc.toString()).toBe(DOC);
        expect(getActiveCell(view.state)).toMatchObject({ section: SECTION_BODY, row: 1, col: 1 });
        expect(view.state.selection.main.anchor).toBe(0);
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('appends a row and opens its first cell for Tab past the last cell', () => {
        const { view } = openHarness({ activeCell: activeCellAt(SECTION_BODY, 1, 1) });

        expect(navigateCell(view, 'next', { allowRowCreation: true })).toBe(true);

        expect(view.state.doc.toString()).toBe(DOC_WITH_APPENDED_ROW);
        const activeCell = getActiveCell(view.state);
        expect(activeCell).toMatchObject({ section: SECTION_BODY, row: 2, col: 0 });
        expect(getPendingOpenCellRequest(view.state)).toMatchObject({
            activeCell,
            initialCursorPos: 'start',
            suppressKeys: true,
        });
    });

    it('appends a row and keeps the column for Enter past the last row', () => {
        const { view } = openHarness({ activeCell: activeCellAt(SECTION_BODY, 1, 1) });

        expect(navigateCell(view, 'down', { allowRowCreation: true })).toBe(true);

        expect(view.state.doc.toString()).toBe(DOC_WITH_APPENDED_ROW);
        expect(getActiveCell(view.state)).toMatchObject({ section: SECTION_BODY, row: 2, col: 1 });
    });

    it('leaves the table unchanged past the last cell when row creation is not allowed', () => {
        const { view } = openHarness({ activeCell: activeCellAt(SECTION_BODY, 1, 1) });

        expect(navigateCell(view, 'next', { allowRowCreation: false })).toBe(true);
        expect(view.state.doc.toString()).toBe(DOC);
        expect(getActiveCell(view.state)).toMatchObject({ section: SECTION_BODY, row: 1, col: 1 });
        expect(view.state.selection.main.anchor).toBe(0);
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it.each([
        ['up', activeCellAt(SECTION_HEADER, 0, 1), EXIT_BEFORE_ANCHOR],
        ['previous', activeCellAt(SECTION_HEADER, 0, 0), EXIT_BEFORE_ANCHOR],
        ['down', activeCellAt(SECTION_BODY, 1, 0), EXIT_AFTER_ANCHOR],
        ['next', activeCellAt(SECTION_BODY, 1, 1), EXIT_AFTER_ANCHOR],
    ] as const)('exits the table moving %s from the grid boundary', (direction, activeCell, exitAnchor) => {
        const { view, focus } = openHarness({ activeCell });

        expect(navigateCell(view, direction, { exitTableAtBoundary: true })).toBe(true);

        expect(view.state.selection.main.anchor).toBe(exitAnchor);
        expect(view.state.doc.lineAt(exitAnchor).text).toBe('');
        expect(getActiveCell(view.state)).toBeNull();
        expect(focus).toHaveBeenCalled();
    });

    // Table exit is requested for every direction, so a row wrap - the nearest thing to a
    // grid edge that is still a legal move - must keep navigating rather than leaving.
    it.each([
        ['previous', activeCellAt(SECTION_BODY, 0, 0), { section: SECTION_HEADER, row: 0, col: 1 }],
        ['next', activeCellAt(SECTION_BODY, 0, 1), { section: SECTION_BODY, row: 1, col: 0 }],
    ] as const)('wraps rather than exiting when %s crosses a row edge mid-grid', (direction, activeCell, expected) => {
        const { view, focus } = openHarness({ activeCell });

        expect(navigateCell(view, direction, { exitTableAtBoundary: true })).toBe(true);

        expect(getActiveCell(view.state)).toMatchObject(expected);
        expect(focus).not.toHaveBeenCalled();
    });

    it('keeps boundary navigation blocked when table exit is not requested', () => {
        const { view, focus } = openHarness({ activeCell: activeCellAt(SECTION_HEADER, 0, 0) });

        expect(navigateCell(view, 'up')).toBe(true);

        expect(getActiveCell(view.state)).toMatchObject({ section: SECTION_HEADER, row: 0, col: 0 });
        expect(view.state.selection.main.anchor).toBe(0);
        expect(focus).not.toHaveBeenCalled();
    });

    it('stays blocked when the table sits against the document edge it would exit through', () => {
        const { view, focus } = openHarness({
            doc: DOC_AT_START,
            activeCell: activeCellAt(SECTION_HEADER, 0, 0, 0),
        });

        expect(navigateCell(view, 'up', { exitTableAtBoundary: true })).toBe(true);

        expect(getActiveCell(view.state)).toMatchObject({ section: SECTION_HEADER, row: 0, col: 0 });
        expect(view.state.selection.main.anchor).toBe(0);
        expect(focus).not.toHaveBeenCalled();
    });
});

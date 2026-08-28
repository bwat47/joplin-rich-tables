/**
 * @vitest-environment jsdom
 */

import { defaultKeymap } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { Direction, EditorView, keymap } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeCellField, getActiveCell, setActiveCellEffect } from '../tableState/activeCellState';
import { cellSelectionField, getCellSelection } from '../tableState/cellSelectionState';
import { searchForceSourceModeField, setSearchForceSourceModeEffect } from '../tableState/searchForceSourceMode';
import { sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { mainEditorTableEntryExtension } from '../tableRuntime/navigation/mainEditorTableEntry';
import { getPendingOpenCellRequest, openCellRequestField } from '../tableRuntime/openCellRequest';
import { cellSelectionKeyCapturePlugin } from '../tableRuntime/selection/cellSelectionKeymap';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { createMarkdownState } from './testMarkdownState';

const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '| b1 | b2 |'].join('\n');
const BEFORE = 'before';
const AFTER = 'after';
const mountedViews: EditorView[] = [];

/**
 * Canonically spaced fixtures: a table needs a blank line on each side, and entering a
 * cell repairs missing spacing in the same transaction. Starting from a document that
 * already has it keeps "the document did not change" an assertion about the deletion
 * filter rather than about normalization.
 */
function docBelowTable(table: string = TABLE): string {
    return `\n${table}\n\n${AFTER}`;
}

function docAboveTable(table: string = TABLE): string {
    return `${BEFORE}\n\n${table}\n`;
}

const BELOW_TABLE_DOC = docBelowTable();
const ABOVE_TABLE_DOC = docAboveTable();
const AROUND_TABLE_DOC = `${BEFORE}\n\n${TABLE}\n\n${AFTER}`;

/** The table's offset in the document as it stands, which entry may have normalized. */
function currentTableFrom(view: EditorView, table: string = TABLE): number {
    return view.state.doc.toString().indexOf(table);
}

/** TableWidget observes its own DOM for height changes; jsdom has no ResizeObserver. */
class ResizeObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}

function mountView(doc: string, selection: number | { anchor: number; head: number }): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const view = new EditorView({
        parent,
        state: createMarkdownState(doc, [
            activeCellField,
            cellSelectionField,
            searchForceSourceModeField,
            sourceModeField,
            openCellRequestField,
            // Tables must render as block replace decorations: vertical entry reads the
            // block structure to find the table a movement stepped over.
            tableDecorationField,
            EditorState.allowMultipleSelections.of(true),
            mainEditorTableEntryExtension,
            cellSelectionKeyCapturePlugin,
            keymap.of(defaultKeymap),
        ]),
    });
    view.dispatch({ selection: typeof selection === 'number' ? { anchor: selection } : selection });
    view.contentDOM.focus();
    mountedViews.push(view);
    return view;
}

function pressKey(view: EditorView, key: string, modifiers: KeyboardEventInit = {}): void {
    view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
            ...modifiers,
        })
    );
}

function expectBoundaryCellOpen(view: EditorView, edge: 'start' | 'end'): void {
    const tableFrom = view.state.doc.toString().indexOf(TABLE);
    expect(getActiveCell(view.state)).toEqual(
        edge === 'start'
            ? { tableFrom, section: 'header', row: 0, col: 0 }
            : { tableFrom, section: 'body', row: 1, col: 1 }
    );
    expect(getPendingOpenCellRequest(view.state)).toMatchObject({ initialCursorPos: edge });
    expect(getCellSelection(view.state)).toBeNull();
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock as unknown as typeof ResizeObserver);
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.replaceChildren();
});

function mockVerticalTarget(view: EditorView, targetPos: number): void {
    vi.spyOn(view, 'moveVertically').mockReturnValue(EditorSelection.cursor(targetPos));
}

function expectCellOpen(
    view: EditorView,
    expected: { tableFrom: number; section: 'header' | 'body'; row: number; col: number },
    initialCursorPos: 'start' | 'end'
): void {
    expect(getActiveCell(view.state)).toEqual(expected);
    expect(getPendingOpenCellRequest(view.state)).toMatchObject({ initialCursorPos });
}

describe('mainEditorTableEntry deletion protection', () => {
    it.each([
        {
            caret: 'blank line above the table',
            key: 'Backspace',
            pos: AROUND_TABLE_DOC.indexOf(TABLE) - 1,
            expected: { kind: 'move', offset: -1 },
        },
        {
            caret: 'blank line above the table',
            key: 'Delete',
            pos: AROUND_TABLE_DOC.indexOf(TABLE) - 1,
            expected: { kind: 'entry', edge: 'start' },
        },
        {
            caret: 'table start',
            key: 'Backspace',
            pos: AROUND_TABLE_DOC.indexOf(TABLE),
            expected: { kind: 'move', offset: -1 },
        },
        {
            caret: 'table start',
            key: 'Delete',
            pos: AROUND_TABLE_DOC.indexOf(TABLE),
            expected: { kind: 'entry', edge: 'start' },
        },
        {
            caret: 'blank line below the table',
            key: 'Backspace',
            pos: AROUND_TABLE_DOC.indexOf(TABLE) + TABLE.length + 1,
            expected: { kind: 'entry', edge: 'end' },
        },
        {
            caret: 'blank line below the table',
            key: 'Delete',
            pos: AROUND_TABLE_DOC.indexOf(TABLE) + TABLE.length + 1,
            expected: { kind: 'move', offset: 1 },
        },
        {
            caret: 'table end',
            key: 'Backspace',
            pos: AROUND_TABLE_DOC.indexOf(TABLE) + TABLE.length,
            expected: { kind: 'entry', edge: 'end' },
        },
        {
            caret: 'table end',
            key: 'Delete',
            pos: AROUND_TABLE_DOC.indexOf(TABLE) + TABLE.length,
            expected: { kind: 'move', offset: 1 },
        },
    ] as const)('$key at $caret preserves the boundary', ({ key, pos, expected }) => {
        const view = mountView(AROUND_TABLE_DOC, pos);

        pressKey(view, key);

        expect(view.state.doc.toString()).toBe(AROUND_TABLE_DOC);
        if (expected.kind === 'entry') {
            expectBoundaryCellOpen(view, expected.edge);
        } else {
            expect(view.state.selection.main.head).toBe(pos + expected.offset);
            expect(getActiveCell(view.state)).toBeNull();
            expect(getPendingOpenCellRequest(view.state)).toBeNull();
        }
    });

    it.each([
        {
            side: 'above',
            key: 'Backspace',
            start: AROUND_TABLE_DOC.indexOf(TABLE),
            positions: [AROUND_TABLE_DOC.indexOf(TABLE) - 1, AROUND_TABLE_DOC.indexOf(TABLE) - 2],
        },
        {
            side: 'below',
            key: 'Delete',
            start: AROUND_TABLE_DOC.indexOf(TABLE) + TABLE.length,
            positions: [
                AROUND_TABLE_DOC.indexOf(TABLE) + TABLE.length + 1,
                AROUND_TABLE_DOC.indexOf(TABLE) + TABLE.length + 2,
            ],
        },
    ] as const)('walks the caret out from the table boundary $side without deleting', ({ key, start, positions }) => {
        const view = mountView(AROUND_TABLE_DOC, start);

        for (const position of positions) {
            pressKey(view, key);
            expect(view.state.doc.toString()).toBe(AROUND_TABLE_DOC);
            expect(view.state.selection.main.head).toBe(position);
            expect(getActiveCell(view.state)).toBeNull();
            expect(getPendingOpenCellRequest(view.state)).toBeNull();
        }
    });

    it.each([
        {
            side: 'above',
            key: 'Backspace',
            start: AROUND_TABLE_DOC.indexOf(TABLE) - 1,
            expectedDoc: `${BEFORE.slice(0, -1)}\n\n${TABLE}\n\n${AFTER}`,
            expectedCaret: BEFORE.length - 1,
        },
        {
            side: 'below',
            key: 'Delete',
            start: AROUND_TABLE_DOC.indexOf(TABLE) + TABLE.length + 1,
            expectedDoc: `${BEFORE}\n\n${TABLE}\n\n${AFTER.slice(1)}`,
            expectedCaret: AROUND_TABLE_DOC.indexOf(TABLE) + TABLE.length + 2,
        },
    ] as const)(
        'deletes text on the next $key after moving away $side',
        ({ key, start, expectedDoc, expectedCaret }) => {
            const view = mountView(AROUND_TABLE_DOC, start);

            pressKey(view, key);
            pressKey(view, key);

            expect(view.state.doc.toString()).toBe(expectedDoc);
            expect(view.state.selection.main.head).toBe(expectedCaret);
            expect(getActiveCell(view.state)).toBeNull();
            expect(getPendingOpenCellRequest(view.state)).toBeNull();
        }
    );

    it.each([
        { key: 'Delete', offset: 0 },
        { key: 'Backspace', offset: 1 },
        { key: 'Delete', offset: 1 },
        { key: 'Backspace', offset: 2 },
    ] as const)('deletes a surplus blank line from run offset $offset with $key', ({ key, offset }) => {
        const doc = `${BEFORE}\n\n\n${TABLE}\n`;
        const view = mountView(doc, BEFORE.length + offset);

        pressKey(view, key);

        expect(view.state.doc.toString()).toBe(ABOVE_TABLE_DOC);
        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('enters the first cell when Delete would consume the newline against the table', () => {
        const doc = `${BEFORE}\n\n\n${TABLE}\n`;
        const view = mountView(doc, doc.indexOf(TABLE) - 1);

        pressKey(view, 'Delete');

        expect(view.state.doc.toString()).toBe(doc);
        expectBoundaryCellOpen(view, 'start');
    });

    it('moves off the table start instead of consuming the newline against it', () => {
        const doc = `${BEFORE}\n\n\n${TABLE}\n`;
        const tableFrom = doc.indexOf(TABLE);
        const view = mountView(doc, tableFrom);

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(doc);
        expect(view.state.selection.main.head).toBe(tableFrom - 1);
        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it.each([
        {
            key: 'Backspace',
            edge: 'end',
            expectedTable: 0,
            caretOffset: 2,
        },
        {
            key: 'Delete',
            edge: 'start',
            expectedTable: 1,
            caretOffset: 2,
        },
    ] as const)(
        'enters the edge cell with $key once a surplus run between two tables is trimmed',
        ({ key, edge, expectedTable, caretOffset }) => {
            const doc = `\n${TABLE}\n\n\n\n${TABLE}\n`;
            const firstTableFrom = doc.indexOf(TABLE);
            const view = mountView(doc, firstTableFrom + TABLE.length + caretOffset);

            // The surplus blank lines are ordinary text: each press removes one until only
            // the required separation is left.
            pressKey(view, key);
            expect(view.state.doc.toString()).toBe(`\n${TABLE}\n\n\n${TABLE}\n`);
            expect(getPendingOpenCellRequest(view.state)).toBeNull();

            pressKey(view, key);

            expect(view.state.doc.toString()).toBe(`\n${TABLE}\n\n\n${TABLE}\n`);
            const currentFirstTableFrom = view.state.doc.toString().indexOf(TABLE);
            const tableFrom =
                expectedTable === 0
                    ? currentFirstTableFrom
                    : view.state.doc.toString().indexOf(TABLE, currentFirstTableFrom + TABLE.length);
            expectCellOpen(
                view,
                edge === 'start'
                    ? { tableFrom, section: 'header', row: 0, col: 0 }
                    : { tableFrom, section: 'body', row: 1, col: 1 },
                edge
            );
        }
    );

    it.each([
        { key: 'Backspace', edge: 'end', expectedTable: 0 },
        { key: 'Delete', edge: 'start', expectedTable: 1 },
    ] as const)(
        'enters the table toward $key from a separator shared by two tables',
        ({ key, edge, expectedTable }) => {
            const doc = `\n${TABLE}\n\n${TABLE}\n`;
            const firstTableFrom = doc.indexOf(TABLE);
            const secondTableFrom = doc.indexOf(TABLE, firstTableFrom + TABLE.length);
            const tableFrom = expectedTable === 0 ? firstTableFrom : secondTableFrom;
            const view = mountView(doc, firstTableFrom + TABLE.length + 1);

            pressKey(view, key);

            expect(view.state.doc.toString()).toBe(doc);
            expectCellOpen(
                view,
                edge === 'start'
                    ? { tableFrom, section: 'header', row: 0, col: 0 }
                    : { tableFrom, section: 'body', row: 1, col: 1 },
                edge
            );
        }
    );

    it('opens the final cell when Backspace reaches the table from below', () => {
        const doc = BELOW_TABLE_DOC;
        const view = mountView(doc, doc.indexOf(AFTER));

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(doc);
        expectBoundaryCellOpen(view, 'end');
    });

    it('leaves a deletion elsewhere in the document alone while a request is in flight', () => {
        const doc = BELOW_TABLE_DOC;
        const view = mountView(doc, doc.indexOf(AFTER));

        pressKey(view, 'Backspace');
        view.dispatch({
            changes: { from: doc.length - 1, to: doc.length },
            userEvent: 'delete.backward',
        });

        expect(view.state.doc.toString()).toBe(doc.slice(0, -1));
    });

    it('drops repeat deletions while the open-cell request is still in flight', () => {
        const doc = BELOW_TABLE_DOC;
        const view = mountView(doc, doc.indexOf(AFTER));

        // The nested editor mounts a frame later, so the main editor still owns these.
        pressKey(view, 'Backspace');
        pressKey(view, 'Backspace');
        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(doc);
        expectBoundaryCellOpen(view, 'end');
    });

    it('opens the first cell when Delete reaches the table from above', () => {
        const doc = ABOVE_TABLE_DOC;
        const view = mountView(doc, BEFORE.length);

        pressKey(view, 'Delete');

        expect(view.state.doc.toString()).toBe(doc);
        expectBoundaryCellOpen(view, 'start');
    });

    it('opens the final header cell when Backspace reaches a table with no body rows', () => {
        const headerOnlyTable = ['| H1 | H2 |', '| --- | --- |'].join('\n');
        const doc = docBelowTable(headerOnlyTable);
        const view = mountView(doc, doc.indexOf(AFTER));

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(doc);
        expect(getActiveCell(view.state)).toEqual({
            tableFrom: doc.indexOf(headerOnlyTable),
            section: 'header',
            row: 0,
            col: 1,
        });
        expect(getPendingOpenCellRequest(view.state)).toMatchObject({ initialCursorPos: 'end' });
        expect(getCellSelection(view.state)).toBeNull();
    });

    it.each([
        {
            label: 'shorter than the header',
            table: ['| H1 | H2 |', '| --- | --- |', '| a1 |'].join('\n'),
            normalized: ['| H1 | H2 |', '| --- | --- |', '| a1 |  |'].join('\n'),
            expectedCol: 0,
        },
        {
            label: 'wider than the header',
            table: ['| H1 |', '| --- |', '| a1 | a2 |'].join('\n'),
            normalized: ['| H1 |  |', '| --- | --- |', '| a1 | a2 |'].join('\n'),
            expectedCol: 1,
        },
    ])('opens the final source-backed cell when the last row is $label', ({ table, normalized, expectedCol }) => {
        const doc = docBelowTable(table);
        const view = mountView(doc, doc.indexOf(AFTER));

        pressKey(view, 'Backspace');

        // A ragged table is not canonical, so entry rewrites it in the same transaction.
        expect(view.state.doc.toString()).toBe(docBelowTable(normalized));
        expect(getActiveCell(view.state)).toEqual({
            tableFrom: currentTableFrom(view, normalized),
            section: 'body',
            row: 0,
            col: expectedCol,
        });
        expect(getPendingOpenCellRequest(view.state)).toMatchObject({ initialCursorPos: 'end' });
        expect(getCellSelection(view.state)).toBeNull();
    });

    it('deletes surplus blank lines but keeps the separation the table needs', () => {
        const doc = `\n${TABLE}\n\n\n${AFTER}`;
        const view = mountView(doc, doc.indexOf(AFTER));

        pressKey(view, 'Backspace');
        expect(view.state.doc.toString()).toBe(BELOW_TABLE_DOC);
        expect(getCellSelection(view.state)).toBeNull();
        expect(getActiveCell(view.state)).toBeNull();

        pressKey(view, 'Backspace');
        expect(view.state.doc.toString()).toBe(BELOW_TABLE_DOC);
        expectBoundaryCellOpen(view, 'end');
    });

    it('deletes a surplus blank line above the table before protecting the boundary', () => {
        const doc = `${BEFORE}\n\n\n${TABLE}\n`;
        const view = mountView(doc, BEFORE.length);

        pressKey(view, 'Delete');
        expect(view.state.doc.toString()).toBe(ABOVE_TABLE_DOC);
        expect(getActiveCell(view.state)).toBeNull();

        pressKey(view, 'Delete');
        expect(view.state.doc.toString()).toBe(ABOVE_TABLE_DOC);
        expectBoundaryCellOpen(view, 'start');
    });

    it('repairs an unspaced table in the transaction that enters it', () => {
        const doc = `${BEFORE}\n${TABLE}\n${AFTER}`;
        const view = mountView(doc, BEFORE.length);

        pressKey(view, 'Delete');

        // The spacing the table is missing is restored as part of entry rather than by a
        // follow-up a frame later, so the document settles within the keystroke.
        expect(view.state.doc.toString()).toBe(`${BEFORE}\n\n${TABLE}\n\n${AFTER}`);
        expectBoundaryCellOpen(view, 'start');
    });

    it('enters a canonical table without touching the document', () => {
        const view = mountView(ABOVE_TABLE_DOC, BEFORE.length);

        pressKey(view, 'Delete');

        expect(view.state.doc.toString()).toBe(ABOVE_TABLE_DOC);
        expectBoundaryCellOpen(view, 'start');
    });

    it('protects the table from a semantic deletion transaction without a physical key event', () => {
        const doc = BELOW_TABLE_DOC;
        const caret = doc.indexOf(AFTER);
        const view = mountView(doc, caret);

        view.dispatch({
            changes: { from: caret - 1, to: caret },
            userEvent: 'delete.backward',
        });

        expect(view.state.doc.toString()).toBe(doc);
        expectBoundaryCellOpen(view, 'end');
    });

    it('leaves DOM and IME-style input transactions to CodeMirror', () => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, TABLE.length + 1);

        view.dispatch({
            changes: { from: TABLE.length, to: TABLE.length + 1 },
            userEvent: 'input.type',
        });

        expect(view.state.doc.toString()).toBe(`${TABLE}after`);
        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('does not redirect a semantic deletion that does not touch the adjoining table', () => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, TABLE.length + 1);

        view.dispatch({
            changes: { from: 1, to: 2 },
            userEvent: 'delete.backward',
        });

        expect(view.state.doc.toString()).not.toBe(doc);
        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it.each([
        { label: 'source mode', effect: toggleSourceModeEffect.of(true) },
        { label: 'search-forced raw mode', effect: setSearchForceSourceModeEffect.of(true) },
    ])('leaves table Markdown editable in $label', ({ effect }) => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, TABLE.length + 1);
        view.dispatch({ effects: effect });

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).not.toBe(doc);
        expect(getCellSelection(view.state)).toBeNull();
        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('does not intercept deletion for a non-collapsed selection', () => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, { anchor: TABLE.length + 1, head: TABLE.length + 'after'.length + 1 });

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(`${TABLE}\n`);
        expect(getCellSelection(view.state)).toBeNull();
        expect(getActiveCell(view.state)).toBeNull();
    });

    it.each([
        {
            label: 'Ctrl+Backspace',
            key: 'Backspace',
            modifiers: { ctrlKey: true },
            doc: BELOW_TABLE_DOC,
            caret: BELOW_TABLE_DOC.indexOf(AFTER),
            edge: 'end' as const,
        },
        {
            label: 'Ctrl+Delete',
            key: 'Delete',
            modifiers: { ctrlKey: true },
            doc: ABOVE_TABLE_DOC,
            caret: BEFORE.length,
            edge: 'start' as const,
        },
        {
            label: 'Shift+Backspace',
            key: 'Backspace',
            modifiers: { shiftKey: true },
            doc: BELOW_TABLE_DOC,
            caret: BELOW_TABLE_DOC.indexOf(AFTER),
            edge: 'end' as const,
        },
    ])('protects the table from $label', ({ key, modifiers, doc, caret, edge }) => {
        const view = mountView(doc, caret);

        pressKey(view, key, modifiers);

        expect(view.state.doc.toString()).toBe(doc);
        expectBoundaryCellOpen(view, edge);
    });

    it('does not enter selection mode while an active cell exists', () => {
        const doc = `${TABLE}\nafter`;
        const view = mountView(doc, TABLE.length + 1);
        view.dispatch({
            effects: setActiveCellEffect.of({
                tableFrom: 0,
                section: 'body',
                row: 1,
                col: 0,
            }),
        });

        pressKey(view, 'Backspace');

        expect(getCellSelection(view.state)).toBeNull();
    });

    it('enters the table one of several carets reaches, collapsing the rest', () => {
        const doc = BELOW_TABLE_DOC;
        const view = mountView(doc, doc.indexOf(AFTER));
        view.dispatch({
            selection: EditorSelection.create([
                EditorSelection.cursor(doc.length),
                EditorSelection.cursor(doc.indexOf(AFTER)),
            ]),
        });

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(doc);
        expect(view.state.selection.ranges).toHaveLength(1);
        expectBoundaryCellOpen(view, 'end');
    });

    it('leaves away-from-table boundary deletion unchanged for multiple carets', () => {
        const tableFrom = AROUND_TABLE_DOC.indexOf(TABLE);
        const view = mountView(AROUND_TABLE_DOC, tableFrom);
        view.dispatch({
            selection: EditorSelection.create([
                EditorSelection.cursor(tableFrom),
                EditorSelection.cursor(AROUND_TABLE_DOC.length),
            ]),
        });

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(`${BEFORE}\n${TABLE}\n\n${AFTER.slice(0, -1)}`);
        expect(view.state.selection.ranges).toHaveLength(2);
        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    // No shipped key deletes past a boundary in one press, so drive the filter directly.
    it('keeps the separator and applies the rest of a multi-character deletion above a table', () => {
        const doc = `${BEFORE}\n\n\n${TABLE}\n`;
        const view = mountView(doc, doc.indexOf(TABLE));

        view.dispatch({
            changes: { from: 0, to: doc.indexOf(TABLE) },
            userEvent: 'delete.backward',
        });

        expect(view.state.doc.toString()).toBe(`\n\n${TABLE}\n`);
        expect(view.state.selection.main.head).toBe(0);
        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('keeps the separator and applies the rest of a multi-character deletion below a table', () => {
        const doc = `\n${TABLE}\n\n\n${AFTER}`;
        const tableTo = doc.indexOf(TABLE) + TABLE.length;
        const view = mountView(doc, tableTo);

        view.dispatch({
            changes: { from: tableTo, to: doc.length },
            userEvent: 'delete.forward',
        });

        expect(view.state.doc.toString()).toBe(`\n${TABLE}\n\n`);
        expect(view.state.selection.main.head).toBe(tableTo + 2);
        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('enters the first table in document order when carets reach two of them', () => {
        const doc = `\n${TABLE}\n\nbetween\n\n${TABLE}\n\n${AFTER}`;
        const view = mountView(doc, doc.indexOf('between'));
        view.dispatch({
            selection: EditorSelection.create([
                EditorSelection.cursor(doc.indexOf('between')),
                EditorSelection.cursor(doc.indexOf(AFTER)),
            ]),
        });

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(doc);
        expect(getActiveCell(view.state)).toEqual({
            tableFrom: doc.indexOf(TABLE),
            section: 'body',
            row: 1,
            col: 1,
        });
    });

    it('still deletes when no caret of a multi-range deletion reaches a table', () => {
        const doc = `${TABLE}\n\nalpha\nbeta`;
        const view = mountView(doc, doc.length);
        view.dispatch({
            selection: EditorSelection.create([
                EditorSelection.cursor(doc.indexOf('alpha') + 'alpha'.length),
                EditorSelection.cursor(doc.length),
            ]),
        });

        pressKey(view, 'Backspace');

        expect(view.state.doc.toString()).toBe(`${TABLE}\n\nalph\nbet`);
        expect(getActiveCell(view.state)).toBeNull();
    });
});

describe('mainEditorTableEntry vertical movement', () => {
    it('opens the top-left header cell when ArrowDown skips across the table widget', () => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}\nbelow`;
        const view = mountView(doc, prefix.length);
        mockVerticalTarget(view, prefix.length + 1 + TABLE.length + 1);

        pressKey(view, 'ArrowDown');

        // The fixture table has no blank line around it, so entry normalizes as it opens.
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
        const doc = `${prefix}\n${TABLE}\nbelow`;
        const view = mountView(doc, prefix.length + 1 + TABLE.length + 1);
        mockVerticalTarget(view, prefix.length);

        pressKey(view, 'ArrowUp');

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
        const doc = `${headerOnlyTable}\nbelow`;
        const view = mountView(doc, headerOnlyTable.length + 1);
        mockVerticalTarget(view, headerOnlyTable.length);

        pressKey(view, 'ArrowUp');

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

    it.each([
        { label: 'source mode', effect: toggleSourceModeEffect.of(true) },
        { label: 'search-forced raw mode', effect: setSearchForceSourceModeEffect.of(true) },
    ])('leaves vertical movement in the main editor during $label', ({ effect }) => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);
        view.dispatch({ effects: effect });
        mockVerticalTarget(view, prefix.length + 1);

        pressKey(view, 'ArrowDown');

        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('does not activate a table when vertical movement stays outside it', () => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);
        mockVerticalTarget(view, prefix.length - 1);

        pressKey(view, 'ArrowDown');

        expect(getActiveCell(view.state)).toBeNull();
    });

    it('requires entry from the side implied by the arrow direction', () => {
        const doc = `${TABLE}\nbelow`;
        const view = mountView(doc, TABLE.length + 1);
        mockVerticalTarget(view, TABLE.length);

        pressKey(view, 'ArrowDown');

        expect(getActiveCell(view.state)).toBeNull();
    });

    it('does not enter the table below when the movement stays inside a wrapped line', () => {
        const wrappedLine = 'a fairly long paragraph that wraps across several visual lines';
        const doc = `${wrappedLine}\n${TABLE}`;
        const view = mountView(doc, 2);
        // A wrapped-line step lands further along the same line block, still short of the table.
        mockVerticalTarget(view, 20);

        pressKey(view, 'ArrowDown');

        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('does not enter a table when the movement lands on an ordinary neighbouring line', () => {
        const doc = `above\nmiddle\n${TABLE}`;
        const view = mountView(doc, 5);
        mockVerticalTarget(view, 8);

        pressKey(view, 'ArrowDown');

        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });

    it('does not intercept a non-collapsed vertical selection', () => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, { anchor: 0, head: prefix.length });
        mockVerticalTarget(view, prefix.length + 1);

        pressKey(view, 'ArrowDown');

        expect(getActiveCell(view.state)).toBeNull();
    });

    it('leaves Shift+ArrowDown to the main editor', () => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);
        mockVerticalTarget(view, prefix.length + 1);

        pressKey(view, 'ArrowDown', { shiftKey: true });

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

        pressKey(view, 'ArrowRight');

        expectCellOpen(view, { tableFrom, section: 'header', row: 0, col: 0 }, 'start');
    });

    it('opens the final cell when ArrowLeft crosses from the empty line below the table', () => {
        const doc = `${TABLE}\n\nbelow`;
        const view = mountView(doc, TABLE.length + 1);

        pressKey(view, 'ArrowLeft');

        expectCellOpen(view, { tableFrom: currentTableFrom(view), section: 'body', row: 1, col: 1 }, 'end');
    });

    it('leaves ordinary horizontal movement to the main editor', () => {
        const doc = `above\n\n${TABLE}`;
        const view = mountView(doc, 1);

        pressKey(view, 'ArrowRight');

        expect(getActiveCell(view.state)).toBeNull();
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
        expect(view.state.selection.main.head).toBe(2);
    });

    it('leaves Shift+ArrowRight to the main editor', () => {
        const prefix = 'above\n';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);

        pressKey(view, 'ArrowRight', { shiftKey: true });

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

        pressKey(view, 'ArrowLeft');

        expectCellOpen(view, { tableFrom, section: 'header', row: 0, col: 0 }, 'start');
    });
});

describe('mainEditorTableEntry key repeat', () => {
    it('pins the caret when ArrowRight repeats while the entry request is in flight', () => {
        const prefix = 'above\n';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);

        pressKey(view, 'ArrowRight');
        const headAfterEntry = view.state.selection.main.head;
        pressKey(view, 'ArrowRight');
        pressKey(view, 'ArrowRight');

        expect(view.state.selection.main.head).toBe(headAfterEntry);
        expectCellOpen(view, { tableFrom: prefix.length + 1, section: 'header', row: 0, col: 0 }, 'start');
    });

    it('pins the caret when ArrowDown repeats while the entry request is in flight', () => {
        const prefix = 'above';
        const doc = `${prefix}\n${TABLE}`;
        const view = mountView(doc, prefix.length);
        mockVerticalTarget(view, prefix.length + 1);

        pressKey(view, 'ArrowDown');
        const headAfterEntry = view.state.selection.main.head;
        pressKey(view, 'ArrowDown');

        expect(view.state.selection.main.head).toBe(headAfterEntry);
        expectCellOpen(view, { tableFrom: currentTableFrom(view), section: 'header', row: 0, col: 0 }, 'start');
    });

    it('pins the caret when an arrow follows a deletion that entered the table', () => {
        const doc = `${TABLE}\n\nbelow`;
        const view = mountView(doc, TABLE.length + 2);

        pressKey(view, 'Backspace');
        pressKey(view, 'Backspace');
        const headAfterEntry = view.state.selection.main.head;
        pressKey(view, 'ArrowRight');
        pressKey(view, 'ArrowRight');

        expect(view.state.selection.main.head).toBe(headAfterEntry);
        expectBoundaryCellOpen(view, 'end');
    });

    it('leaves arrow keys to the main editor when no request is in flight', () => {
        const doc = `above\n\n${TABLE}`;
        const view = mountView(doc, 0);

        pressKey(view, 'ArrowRight');
        pressKey(view, 'ArrowRight');

        expect(view.state.selection.main.head).toBe(2);
        expect(getPendingOpenCellRequest(view.state)).toBeNull();
    });
});

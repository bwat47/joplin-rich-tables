/**
 * Shared harness for main-editor table entry tests (arrow-key entry and boundary deletion).
 *
 * Each suite creates its own harness and calls install/cleanup from its lifecycle hooks.
 * Keep it scoped to entry tests; general helpers belong in `tableEditorFixtures`.
 */
import { defaultKeymap } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { expect, vi } from 'vitest';

import { cellSelectionKeyCapturePlugin } from '../tableRuntime/selection/cellSelectionKeymap';
import { activeCellField, getActiveCell } from '../tableState/activeCellState';
import { cellSelectionField, getCellSelection } from '../tableState/cellSelectionState';
import { getPendingOpenCellRequest, openCellRequestField } from '../tableState/openCellRequestState';
import { sourceModeField, toggleSourceModeEffect } from '../tableState/sourceMode';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { createResizeObserverStub } from './tableEditorFixtures';
import { createMarkdownState } from './testMarkdownState';

export const TABLE = ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |', '| b1 | b2 |'].join('\n');

export type EntryEdge = 'start' | 'end';

export interface ExpectedActiveCell {
    tableFrom: number;
    section: 'header' | 'body';
    row: number;
    col: number;
}

export interface RawModeCase {
    label: string;
    enterRawMode: (view: EditorView) => void;
}

/** The two ways every table stops rendering as a widget. */
export const RAW_MODE_CASES: readonly RawModeCase[] = [
    {
        label: 'source mode',
        enterRawMode: (view: EditorView): void => {
            view.dispatch({ effects: toggleSourceModeEffect.of(true) });
        },
    },
    {
        label: 'search-forced raw mode',
        enterRawMode: (view: EditorView): void => {
            openSearchPanel(view);
        },
    },
];

/** The table's offset in the document as it stands, which entry may have normalized. */
export function currentTableFrom(view: EditorView, table: string = TABLE): number {
    return view.state.doc.toString().indexOf(table);
}

export interface TableEntryTestHarness {
    /** Installs the ResizeObserver stub before each test. */
    install(): void;
    /** Restores mocks and globals, destroys mounted views, and clears the document. */
    cleanup(): void;
    /** Mounts a focused editor, with entry extensions ahead of selection and default keymaps. */
    mountView(
        doc: string,
        selection: number | { anchor: number; head: number },
        entryExtensions: Extension[]
    ): EditorView;
}

/** Creates isolated view tracking and lifecycle operations for one table-entry suite. */
export function createTableEntryTestHarness(): TableEntryTestHarness {
    const resizeObserver = createResizeObserverStub();
    const mountedViews: EditorView[] = [];

    return {
        install(): void {
            // TableWidget observes its own DOM for height changes; jsdom has no ResizeObserver.
            resizeObserver.install();
        },
        cleanup(): void {
            vi.restoreAllMocks();
            vi.unstubAllGlobals();
            while (mountedViews.length > 0) {
                mountedViews.pop()?.destroy();
            }
            document.body.replaceChildren();
        },
        mountView(
            doc: string,
            selection: number | { anchor: number; head: number },
            entryExtensions: Extension[]
        ): EditorView {
            const parent = document.createElement('div');
            document.body.appendChild(parent);

            const view = new EditorView({
                parent,
                state: createMarkdownState(doc, [
                    activeCellField,
                    cellSelectionField,
                    sourceModeField,
                    openCellRequestField,
                    // Tables must render as block replace decorations: vertical entry reads the
                    // block structure to find the table a movement stepped over.
                    tableDecorationField,
                    EditorState.allowMultipleSelections.of(true),
                    ...entryExtensions,
                    cellSelectionKeyCapturePlugin,
                    keymap.of(defaultKeymap),
                ]),
            });
            view.dispatch({ selection: typeof selection === 'number' ? { anchor: selection } : selection });
            view.contentDOM.focus();
            mountedViews.push(view);
            return view;
        },
    };
}

export function pressKey(view: EditorView, key: string, modifiers: KeyboardEventInit = {}): void {
    view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
            ...modifiers,
        })
    );
}

export function expectCellOpen(view: EditorView, expected: ExpectedActiveCell, initialCursorPos: EntryEdge): void {
    expect(getActiveCell(view.state)).toEqual(expected);
    expect(getPendingOpenCellRequest(view.state)).toMatchObject({ initialCursorPos });
}

/** Asserts `TABLE`'s first cell (`start`) or last cell (`end`) is opening, with no cell selection. */
export function expectBoundaryCellOpen(view: EditorView, edge: EntryEdge): void {
    const tableFrom = currentTableFrom(view);
    expectCellOpen(
        view,
        edge === 'start'
            ? { tableFrom, section: 'header', row: 0, col: 0 }
            : { tableFrom, section: 'body', row: 1, col: 1 },
        edge
    );
    expect(getCellSelection(view.state)).toBeNull();
}

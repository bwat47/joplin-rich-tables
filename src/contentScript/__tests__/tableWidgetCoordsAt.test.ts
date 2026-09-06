import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { markdownRenderServiceFacet } from '../services/markdownRenderer';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { findCellForPos } from '../tableModel/markdownTableCellRanges';
import { activeCellField, setActiveCellEffect } from '../tableState/activeCellState';
import { resolvedActiveCellField } from '../tableRuntime/activeCell/resolvedActiveCell';
import { TableWidget } from '../tableWidget/TableWidget';
import { tableDecorationField } from '../tableWidget/tableDecorationField';
import { htmlFragment, parseCellRangesFixture } from './testUtils';

class ResizeObserverMock {
    observe = vi.fn();
    disconnect = vi.fn();
}

/** Mounts a real EditorView wired with tableDecorationField, so widgets are built/updated exactly as in production. */
function createRealView(doc: string): { parent: HTMLElement; view: EditorView } {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const state = EditorState.create({
        doc,
        extensions: [
            markdown({ extensions: [GFM] }),
            markdownRenderServiceFacet.of({
                getCached: vi.fn(() => undefined),
                render: vi.fn(async () => htmlFragment('')),
                clear: vi.fn(),
            }),
            activeCellField,
            resolvedActiveCellField,
            tableDecorationField,
        ],
    });

    return {
        parent,
        view: new EditorView({ parent, state }),
    };
}

describe('TableWidget coordsAt', () => {
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', ResizeObserverMock as unknown as typeof ResizeObserver);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('resolves coordinates from widget-relative positions when the table starts after document offset 0', () => {
        const tableText = ['| H1 | H2 |', '| --- | --- |', '| body 1 | body 2 |'].join('\n');
        const table = MarkdownTable.parse(tableText);
        const cellRanges = parseCellRangesFixture(tableText);
        if (!table) {
            throw new Error('Expected test table to parse');
        }

        const state = EditorState.create({
            extensions: [
                markdownRenderServiceFacet.of({
                    getCached: vi.fn(() => htmlFragment('')),
                    render: vi.fn(async () => htmlFragment('')),
                    clear: vi.fn(),
                }),
            ],
        });
        const view = {
            state,
            dom: document.createElement('div'),
            requestMeasure: vi.fn(),
        } as unknown as EditorView;

        const tableFrom = 50;
        const widget = new TableWidget(table, cellRanges, tableText, tableFrom);
        const dom = widget.toDOM(view);
        const targetCell = dom.querySelector('tbody td:nth-child(2)') as HTMLElement | null;
        if (!targetCell) {
            throw new Error('Expected second body cell to render');
        }

        const rect = { top: 10, bottom: 20, left: 30, right: 40 } as DOMRect;
        vi.spyOn(targetCell, 'getBoundingClientRect').mockReturnValue(rect);

        expect(widget.coordsAt(dom, cellRanges.rows[0][1].from, 1)).toBe(rect);
        expect(widget.coordsAt(dom, tableFrom + cellRanges.rows[0][1].from, 1)).toBeNull();
    });

    describe('with a live, unrebuilt widget', () => {
        // In-cell edits are forwarded from the nested editor as transactions carrying
        // syncAnnotation. tableDecorationPolicy routes those through the mapDecorations path,
        // which shifts the decoration's range but does NOT rebuild the TableWidget — so the
        // widget's own `cellRanges` stay frozen at pre-edit offsets even though the live document
        // has changed underneath it. coordsAt must still resolve positions correctly in that state.
        const TABLE_TEXT = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');
        const TABLE_FROM = 0;

        // A sync transaction only ever originates from an open nested editor, so the active cell
        // is always set alongside it. Reproducing that here matters: coordsAt reads the live cell
        // ranges from resolvedActiveCellField, which is only populated while a cell is active.
        function editCellAWithoutRebuild(view: EditorView, insertText: string): void {
            const cellARanges = parseCellRangesFixture(view.state.doc.toString());
            const cellAFrom = cellARanges.rows[0][0].editableFrom;
            const cellATo = cellARanges.rows[0][0].editableTo;
            view.dispatch({
                effects: setActiveCellEffect.of({ tableFrom: TABLE_FROM, section: 'body', row: 0, col: 0 }),
            });
            view.dispatch({
                changes: { from: cellAFrom, to: cellATo, insert: insertText },
                annotations: [syncAnnotation.of(true)],
            });
        }

        it('resolves a position inside the edited cell even though it postdates the cached cellRanges', () => {
            const { parent, view } = createRealView(TABLE_TEXT);
            try {
                editCellAWithoutRebuild(view, 'aaaaaaaaaa');

                const liveRanges = parseCellRangesFixture(view.state.doc.toString());
                // Points at the tail of the newly inserted text -- past where the pre-edit
                // cellRanges recorded cell A as ending.
                const posInGrownCellA = liveRanges.rows[0][0].editableTo;

                const cellA = view.contentDOM.querySelector('tbody td:nth-child(1)') as HTMLElement | null;
                if (!cellA) {
                    throw new Error('Expected first body cell to render');
                }
                const rect = { top: 1, bottom: 2, left: 3, right: 4 } as DOMRect;
                vi.spyOn(cellA, 'getBoundingClientRect').mockReturnValue(rect);

                // view.coordsAtPos() collapses the rect to a zero-width caret (left === right)
                // depending on approach side, so only top/bottom/left identify which cell it used.
                expect(view.coordsAtPos(posInGrownCellA)).toMatchObject({
                    top: rect.top,
                    bottom: rect.bottom,
                    left: rect.left,
                });
            } finally {
                view.destroy();
                parent.remove();
            }
        });

        it('resolves a different, untouched cell correctly rather than the edited one', () => {
            const { parent, view } = createRealView(TABLE_TEXT);
            try {
                editCellAWithoutRebuild(view, 'aaaaaaaaaa');

                const liveRanges = parseCellRangesFixture(view.state.doc.toString());
                const posInCellB = liveRanges.rows[0][1].editableFrom;

                const cellA = view.contentDOM.querySelector('tbody td:nth-child(1)') as HTMLElement | null;
                const cellB = view.contentDOM.querySelector('tbody td:nth-child(2)') as HTMLElement | null;
                if (!cellA || !cellB) {
                    throw new Error('Expected both body cells to render');
                }
                const wrongRect = { top: 999, bottom: 999, left: 999, right: 999 } as DOMRect;
                const correctRect = { top: 10, bottom: 20, left: 30, right: 40 } as DOMRect;
                vi.spyOn(cellA, 'getBoundingClientRect').mockReturnValue(wrongRect);
                vi.spyOn(cellB, 'getBoundingClientRect').mockReturnValue(correctRect);

                // Must resolve to cell B specifically, not fall back to whichever cell was edited.
                expect(view.coordsAtPos(posInCellB)).toMatchObject({
                    top: correctRect.top,
                    bottom: correctRect.bottom,
                    left: correctRect.left,
                });
            } finally {
                view.destroy();
                parent.remove();
            }
        });

        it('does not fall back to stale ranges when the live position is not inside a cell', () => {
            const longTableText = ['| H1 | H2 |', '| --- | --- |', '| aaaaaaaaaa | b |'].join('\n');
            const table = MarkdownTable.parse(longTableText);
            const cachedRanges = parseCellRangesFixture(longTableText);
            if (!table) {
                throw new Error('Expected table to parse');
            }

            const { parent, view } = createRealView(longTableText);
            const widget = new TableWidget(table, cachedRanges, longTableText, 0);
            const dom = widget.toDOM(view);
            vi.spyOn(view, 'posAtDOM').mockReturnValue(0);

            try {
                editCellAWithoutRebuild(view, 'a');

                const liveRanges = parseCellRangesFixture(view.state.doc.toString());
                const delimiterPos = liveRanges.rows[0][0].editableTo + 1;

                // This position moved into the delimiter after cell A was shortened, but the
                // pre-edit ranges still identify it as part of the old, longer cell A.
                expect(findCellForPos(liveRanges, delimiterPos)).toBeNull();
                expect(findCellForPos(cachedRanges, delimiterPos)).not.toBeNull();
                expect(widget.coordsAt(dom, delimiterPos, 1)).toBeNull();
            } finally {
                widget.destroy(dom);
                view.destroy();
                parent.remove();
            }
        });
    });

    it('resolves coords in a previously edited table after activation switches to another table', () => {
        // Regression test: editing table A freezes its widget via mapDecorations, and a bare
        // setActiveCellEffect switch to table B (no doc change, no normalization needed) moves
        // resolvedActiveCellField to B — so A's frozen widget is no longer covered by the live
        // ranges. The decoration policy must rebuild on the switch so A's widget picks up
        // post-edit cellRanges; otherwise coordsAt() resolves A against pre-edit offsets.
        const tableA = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');
        const tableB = ['| X1 | X2 |', '| --- | --- |', '| x | y |'].join('\n');

        const { parent, view } = createRealView(`${tableA}\n\n${tableB}`);
        try {
            // Activate cell A[0][0] and grow it via a sync edit (nested-editor forwarding path).
            const preRanges = parseCellRangesFixture(tableA);
            view.dispatch({
                effects: setActiveCellEffect.of({ tableFrom: 0, section: 'body', row: 0, col: 0 }),
            });
            view.dispatch({
                changes: {
                    from: preRanges.rows[0][0].editableFrom,
                    to: preRanges.rows[0][0].editableTo,
                    insert: 'aaaaaaaaaa',
                },
                annotations: [syncAnnotation.of(true)],
            });

            // Switch activation to table B the way requestOpenCell does: bare effect, no doc
            // change. Production resolves B at its current (post-edit) position at click time.
            const tableBFrom = view.state.doc.toString().indexOf('| X1');
            view.dispatch({
                effects: setActiveCellEffect.of({ tableFrom: tableBFrom, section: 'body', row: 0, col: 0 }),
            });

            const liveDocText = view.state.doc.toString();
            const liveARanges = parseCellRangesFixture(liveDocText.slice(0, liveDocText.indexOf('\n\n')));
            // Tail of the grown cell A: past where A's pre-edit ranges said the cell ended.
            const posInGrownCellA = liveARanges.rows[0][0].editableTo;

            const tableABody = view.contentDOM.querySelectorAll('tbody')[0];
            const cellA = tableABody?.querySelector('td:nth-child(1)') as HTMLElement | null;
            const cellB = tableABody?.querySelector('td:nth-child(2)') as HTMLElement | null;
            if (!cellA || !cellB) throw new Error('Expected table A cells to render');
            const rect = { top: 1, bottom: 2, left: 3, right: 4 } as DOMRect;
            const wrongRect = { top: 999, bottom: 999, left: 999, right: 999 } as DOMRect;
            vi.spyOn(cellA, 'getBoundingClientRect').mockReturnValue(rect);
            vi.spyOn(cellB, 'getBoundingClientRect').mockReturnValue(wrongRect);

            expect(view.coordsAtPos(posInGrownCellA)).toMatchObject({
                top: rect.top,
                bottom: rect.bottom,
                left: rect.left,
            });
        } finally {
            view.destroy();
            parent.remove();
        }
    });

    it('falls back to cached cellRanges when the DOM has no live view registered', () => {
        // toDOM() was called directly (as in the test above), bypassing the widgetDomState entry
        // that resolveLiveCellCoords() needs -- coordsAt must still resolve via the constructor's
        // cellRanges rather than fail outright.
        const tableText = ['| H1 | H2 |', '| --- | --- |', '| body 1 | body 2 |'].join('\n');
        const table = MarkdownTable.parse(tableText);
        const cellRanges = parseCellRangesFixture(tableText);
        if (!table) {
            throw new Error('Expected test table to parse');
        }

        const state = EditorState.create({
            extensions: [
                markdownRenderServiceFacet.of({
                    getCached: vi.fn(() => htmlFragment('')),
                    render: vi.fn(async () => htmlFragment('')),
                    clear: vi.fn(),
                }),
            ],
        });
        const view = {
            state,
            dom: document.createElement('div'),
            requestMeasure: vi.fn(),
        } as unknown as EditorView;

        const widget = new TableWidget(table, cellRanges, tableText, 0);
        // toDOM() records widgetDomState for this dom, so route through a detached clone instead
        // to exercise the "no state registered" fallback path.
        const dom = widget.toDOM(view).cloneNode(true) as HTMLElement;

        const targetCell = dom.querySelector('tbody td:nth-child(2)') as HTMLElement | null;
        if (!targetCell) {
            throw new Error('Expected second body cell to render');
        }
        const rect = { top: 10, bottom: 20, left: 30, right: 40 } as DOMRect;
        vi.spyOn(targetCell, 'getBoundingClientRect').mockReturnValue(rect);

        expect(widget.coordsAt(dom, cellRanges.rows[0][1].from, 1)).toBe(rect);
    });
});

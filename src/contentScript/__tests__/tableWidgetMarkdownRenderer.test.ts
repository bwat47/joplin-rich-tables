/** @vitest-environment jsdom */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { markdownRenderServiceFacet, type MarkdownRenderService } from '../services/markdownRenderer';
import { CLASS_CELL_ACTIVE } from '../shared/tableDomClasses';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { computeMarkdownTableCellRanges } from '../tableModel/markdownTableCellRanges';
import { TableWidget } from '../tableWidget/TableWidget';
import { deferred } from './testUtils';

class ResizeObserverMock {
    observe = vi.fn();
    disconnect = vi.fn();
}

describe('TableWidget markdown rendering', () => {
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', ResizeObserverMock as unknown as typeof ResizeObserver);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('uses the markdown renderer supplied by the editor state facet', async () => {
        const rendered = deferred<string>();
        const tableText = ['| H1 |', '| --- |', '| **body** |'].join('\n');
        const table = MarkdownTable.parse(tableText);
        const cellRanges = computeMarkdownTableCellRanges(tableText);
        if (!table || !cellRanges) {
            throw new Error('Expected test table to parse');
        }

        const renderer: MarkdownRenderService = {
            getCached: vi.fn(() => undefined),
            render: vi.fn(() => rendered.promise),
            clear: vi.fn(),
        };
        const state = EditorState.create({
            extensions: [markdownRenderServiceFacet.of(renderer)],
        });
        const view = {
            state,
            dom: document.createElement('div'),
            requestMeasure: vi.fn(),
        } as unknown as EditorView;

        const widget = new TableWidget(table, cellRanges, tableText, 0);
        const dom = widget.toDOM(view);
        document.body.appendChild(dom);
        rendered.resolve('<p><strong>rendered</strong></p>');
        await rendered.promise;
        // The widget attaches its DOM update in a .then() on the same promise.
        // Let that chained microtask run before asserting the rendered HTML.
        await Promise.resolve();

        expect(renderer.render).toHaveBeenCalledWith('**body**');
        expect(dom.querySelector('tbody td div')?.innerHTML).toBe('<p><strong>rendered</strong></p>');
        dom.remove();
    });

    it('resolves coordinates from widget-relative positions when the table starts after document offset 0', () => {
        const tableText = ['| H1 | H2 |', '| --- | --- |', '| body 1 | body 2 |'].join('\n');
        const table = MarkdownTable.parse(tableText);
        const cellRanges = computeMarkdownTableCellRanges(tableText);
        if (!table || !cellRanges) {
            throw new Error('Expected test table to parse');
        }

        const state = EditorState.create({
            extensions: [
                markdownRenderServiceFacet.of({
                    getCached: vi.fn(() => ''),
                    render: vi.fn(async () => ''),
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

    it('resolves to the actively edited cell instead of stale cellRanges when one is open', () => {
        // Simulates the state during in-cell editing: cellRanges was computed before the edit
        // (mapDecorations keeps the widget alive without rebuilding it, see
        // tableDecorationPolicy.ts), so a position that is valid in the live document no longer
        // matches the recorded offsets for the cell actually being edited.
        const tableText = ['| H1 | H2 |', '| --- | --- |', '| body 1 | body 2 |'].join('\n');
        const table = MarkdownTable.parse(tableText);
        const cellRanges = computeMarkdownTableCellRanges(tableText);
        if (!table || !cellRanges) {
            throw new Error('Expected test table to parse');
        }

        const state = EditorState.create({
            extensions: [
                markdownRenderServiceFacet.of({
                    getCached: vi.fn(() => ''),
                    render: vi.fn(async () => ''),
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
        const dom = widget.toDOM(view);

        const staleCell = dom.querySelector('tbody td:nth-child(2)') as HTMLElement | null;
        const activeCell = dom.querySelector('tbody td:nth-child(1)') as HTMLElement | null;
        if (!staleCell || !activeCell) {
            throw new Error('Expected both body cells to render');
        }
        activeCell.classList.add(CLASS_CELL_ACTIVE);

        const staleRect = { top: 999, bottom: 999, left: 999, right: 999 } as DOMRect;
        const activeRect = { top: 10, bottom: 20, left: 30, right: 40 } as DOMRect;
        vi.spyOn(staleCell, 'getBoundingClientRect').mockReturnValue(staleRect);
        vi.spyOn(activeCell, 'getBoundingClientRect').mockReturnValue(activeRect);

        // A position that would resolve (via stale cellRanges) to the second cell must still
        // return the active cell's rect, since it's the only cell with a real cursor.
        expect(widget.coordsAt(dom, cellRanges.rows[0][1].from, 1)).toBe(activeRect);
    });
});

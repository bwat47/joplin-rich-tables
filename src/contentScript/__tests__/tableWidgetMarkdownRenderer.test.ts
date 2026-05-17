/** @jest-environment jsdom */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { markdownRenderServiceFacet, type MarkdownRenderService } from '../services/markdownRenderer';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { computeMarkdownTableCellRanges } from '../tableModel/markdownTableCellRanges';
import { TableWidget } from '../tableWidget/TableWidget';
import { deferred } from './testUtils';

class ResizeObserverMock {
    observe = jest.fn();
    disconnect = jest.fn();
}

describe('TableWidget markdown rendering', () => {
    const originalResizeObserver = window.ResizeObserver;

    beforeEach(() => {
        window.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
    });

    afterEach(() => {
        window.ResizeObserver = originalResizeObserver;
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
            getCached: jest.fn(() => undefined),
            render: jest.fn(() => rendered.promise),
            clear: jest.fn(),
        };
        const state = EditorState.create({
            extensions: [markdownRenderServiceFacet.of(renderer)],
        });
        const view = {
            state,
            dom: document.createElement('div'),
            requestMeasure: jest.fn(),
        } as unknown as EditorView;

        const widget = new TableWidget(table, cellRanges, tableText, 0, tableText.length, 'hash');
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
                    getCached: jest.fn(() => ''),
                    renderAsync: jest.fn(),
                    clear: jest.fn(),
                }),
            ],
        });
        const view = {
            state,
            dom: document.createElement('div'),
            requestMeasure: jest.fn(),
        } as unknown as EditorView;

        const tableFrom = 50;
        const widget = new TableWidget(table, cellRanges, tableText, tableFrom, tableFrom + tableText.length, 'hash');
        const dom = widget.toDOM(view);
        const targetCell = dom.querySelector('tbody td:nth-child(2)') as HTMLElement | null;
        if (!targetCell) {
            throw new Error('Expected second body cell to render');
        }

        const rect = { top: 10, bottom: 20, left: 30, right: 40 } as DOMRect;
        jest.spyOn(targetCell, 'getBoundingClientRect').mockReturnValue(rect);

        expect(widget.coordsAt(dom, cellRanges.rows[0][1].from, 1)).toBe(rect);
        expect(widget.coordsAt(dom, tableFrom + cellRanges.rows[0][1].from, 1)).toBeNull();
    });
});

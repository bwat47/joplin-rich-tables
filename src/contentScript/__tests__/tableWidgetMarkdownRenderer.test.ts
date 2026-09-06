import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { markdownRenderServiceFacet, type MarkdownRenderService } from '../services/markdownRenderer';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { TableWidget } from '../tableWidget/TableWidget';
import { deferred, htmlFragment, parseCellRangesFixture } from './testUtils';

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
        const rendered = deferred<DocumentFragment>();
        const tableText = ['| H1 |', '| --- |', '| **body** |'].join('\n');
        const table = MarkdownTable.parse(tableText);
        const cellRanges = parseCellRangesFixture(tableText);
        if (!table) {
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
        rendered.resolve(htmlFragment('<p><strong>rendered</strong></p>'));
        await rendered.promise;
        // The widget attaches its DOM update in a .then() on the same promise.
        // Let that chained microtask run before asserting the rendered HTML.
        await Promise.resolve();

        expect(renderer.render).toHaveBeenCalledWith('**body**');
        expect(dom.querySelector('tbody td div')?.innerHTML).toBe('<p><strong>rendered</strong></p>');
        dom.remove();
    });
});

/** @jest-environment jsdom */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { markdownRenderServiceFacet, type MarkdownRenderService } from '../services/markdownRenderer';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { computeMarkdownTableCellRanges } from '../tableModel/markdownTableCellRanges';
import { TableWidget } from '../tableWidget/TableWidget';

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

    it('uses the markdown renderer supplied by the editor state facet', () => {
        const renderCallbacks: Array<(html: string) => void> = [];
        const tableText = ['| H1 |', '| --- |', '| **body** |'].join('\n');
        const table = MarkdownTable.parse(tableText);
        const cellRanges = computeMarkdownTableCellRanges(tableText);
        if (!table || !cellRanges) {
            throw new Error('Expected test table to parse');
        }

        const renderer: MarkdownRenderService = {
            getCached: jest.fn(() => undefined),
            renderAsync: jest.fn((_text: string, callback: (html: string) => void) => {
                renderCallbacks.push(callback);
            }),
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
        renderCallbacks[0]?.('<p><strong>rendered</strong></p>');

        expect(renderer.renderAsync).toHaveBeenCalledWith('**body**', expect.any(Function));
        expect(dom.querySelector('tbody td div')?.innerHTML).toBe('<p><strong>rendered</strong></p>');
        dom.remove();
    });
});

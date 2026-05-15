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

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
} {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((promiseResolve) => {
        resolve = promiseResolve;
    });

    return { promise, resolve };
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
        await Promise.resolve();

        expect(renderer.render).toHaveBeenCalledWith('**body**');
        expect(dom.querySelector('tbody td div')?.innerHTML).toBe('<p><strong>rendered</strong></p>');
        dom.remove();
    });
});

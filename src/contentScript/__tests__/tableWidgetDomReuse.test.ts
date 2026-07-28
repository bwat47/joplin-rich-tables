/** @vitest-environment jsdom */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markdownRenderServiceFacet } from '../services/markdownRenderer';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { computeMarkdownTableCellRanges } from '../tableModel/markdownTableCellRanges';
import { TableWidget } from '../tableWidget/TableWidget';

class ResizeObserverMock {
    observe = vi.fn();
    disconnect = vi.fn();
}

const TABLE_TEXT = ['| H1 | H2 |', '| --- | --- |', '| a | b |'].join('\n');
const EDITED_TABLE_TEXT = ['| H1 | H2 |', '| --- | --- |', '| a | CHANGED |'].join('\n');

function createWidget(tableText: string, tableFrom = 0): TableWidget {
    const table = MarkdownTable.parse(tableText);
    const cellRanges = computeMarkdownTableCellRanges(tableText);
    if (!table || !cellRanges) {
        throw new Error('Expected test table to parse');
    }
    return new TableWidget(table, cellRanges, tableText, tableFrom);
}

function createView(): EditorView {
    const state = EditorState.create({
        extensions: [
            markdownRenderServiceFacet.of({
                getCached: vi.fn(() => ''),
                render: vi.fn(async () => ''),
                clear: vi.fn(),
            }),
        ],
    });

    return {
        state,
        dom: document.createElement('div'),
        requestMeasure: vi.fn(),
    } as unknown as EditorView;
}

describe('TableWidget DOM reuse', () => {
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', ResizeObserverMock as unknown as typeof ResizeObserver);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reuses the existing DOM when the table source is unchanged', () => {
        const view = createView();
        const dom = createWidget(TABLE_TEXT).toDOM(view);
        const originalTable = dom.querySelector('table');

        const reused = createWidget(TABLE_TEXT).updateDOM(dom, view);

        expect(reused).toBe(true);
        // Reuse must preserve the actual nodes — this is what keeps videos and embeds alive.
        expect(dom.querySelector('table')).toBe(originalTable);
    });

    it('rebuilds when the table source changed', () => {
        const view = createView();
        const dom = createWidget(TABLE_TEXT).toDOM(view);

        expect(createWidget(EDITED_TABLE_TEXT).updateDOM(dom, view)).toBe(false);
    });

    it('reuses the DOM when only the document position changed', () => {
        const view = createView();
        const dom = createWidget(TABLE_TEXT, 0).toDOM(view);

        const reused = createWidget(TABLE_TEXT, 120).updateDOM(dom, view);

        expect(reused).toBe(true);
        expect(dom.getAttribute('data-table-from')).toBe('120');
    });

    it('rebuilds when the DOM was not produced by a table widget', () => {
        const view = createView();
        const foreignDom = document.createElement('div');

        expect(createWidget(TABLE_TEXT).updateDOM(foreignDom, view)).toBe(false);
    });
});

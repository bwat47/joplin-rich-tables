/** @vitest-environment jsdom */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markdownRenderServiceFacet } from '../services/markdownRenderer';
import { MarkdownTable } from '../tableModel/MarkdownTable';
import { computeMarkdownTableCellRanges } from '../tableModel/markdownTableCellRanges';
import { TableWidget } from '../tableWidget/TableWidget';
import { tableHeightCache } from '../tableWidget/tableHeightCache';

const observerCallbacks: Array<() => void> = [];

class ResizeObserverMock {
    observe = vi.fn();
    disconnect = vi.fn();

    constructor(callback: () => void) {
        observerCallbacks.push(callback);
    }
}

/** Fires every ResizeObserver created during the test, as a real resize would. */
function triggerResize(): void {
    for (const callback of observerCallbacks) {
        callback();
    }
}

function stubHeight(element: HTMLElement, heightPx: number): void {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ height: heightPx } as DOMRect);
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
        // CodeMirror batches these into its measure phase; running read() inline keeps the
        // assertions synchronous without changing what the widget schedules.
        requestMeasure: vi.fn((spec: { read: () => void }) => spec.read()),
        // destroy() routes through cleanupHostedNestedEditors, which looks up the nested editor
        // plugin. No nested editor is mounted in these tests.
        plugin: vi.fn(() => null),
    } as unknown as EditorView;
}

describe('TableWidget DOM reuse', () => {
    beforeEach(() => {
        observerCallbacks.length = 0;
        tableHeightCache.clear();
        vi.stubGlobal('ResizeObserver', ResizeObserverMock as unknown as typeof ResizeObserver);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
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

    describe('height measurement', () => {
        const MEASURED_HEIGHT = 250;
        const ORIGINAL_FROM = 0;
        const MOVED_FROM = 120;
        // Queries the cache by position alone: tableHeightCache.get() also matches on text, so
        // an unrelated text forces the lookup to be satisfied by the position key or not at all.
        const UNRELATED_TEXT = 'unrelated';

        it('records the current position after the table moved, not the mounted one', () => {
            const view = createView();
            const dom = createWidget(TABLE_TEXT, ORIGINAL_FROM).toDOM(view);
            document.body.appendChild(dom);

            expect(createWidget(TABLE_TEXT, MOVED_FROM).updateDOM(dom, view)).toBe(true);

            // Stub only now, so the assertion reflects the ResizeObserver callback alone. That
            // callback is created once at mount and outlives the widget that created it, so it
            // must resolve the position at fire time rather than at creation time.
            stubHeight(dom, MEASURED_HEIGHT);
            triggerResize();

            expect(tableHeightCache.get({ tableFrom: MOVED_FROM, tableText: UNRELATED_TEXT })).toBe(MEASURED_HEIGHT);
            expect(tableHeightCache.get({ tableFrom: ORIGINAL_FROM, tableText: UNRELATED_TEXT })).toBeUndefined();

            dom.remove();
        });

        it('records the last known height on destroy', () => {
            const view = createView();
            const widget = createWidget(TABLE_TEXT, ORIGINAL_FROM);
            const dom = widget.toDOM(view);
            document.body.appendChild(dom);

            stubHeight(dom, MEASURED_HEIGHT);
            widget.destroy(dom);

            expect(tableHeightCache.get({ tableFrom: ORIGINAL_FROM, tableText: UNRELATED_TEXT })).toBe(MEASURED_HEIGHT);

            dom.remove();
        });
    });

    describe('eq', () => {
        it('is equal when neither the source nor the position changed', () => {
            expect(createWidget(TABLE_TEXT, 40).eq(createWidget(TABLE_TEXT, 40))).toBe(true);
        });

        it('is not equal when the source changed', () => {
            expect(createWidget(TABLE_TEXT, 40).eq(createWidget(EDITED_TABLE_TEXT, 40))).toBe(false);
        });

        it('is not equal when only the position changed', () => {
            // In-cell edits map decorations instead of rebuilding them, so a widget's tableFrom
            // drifts from the document. Comparing it routes the table through updateDOM(), which
            // refreshes the recorded position the height cache keys off.
            expect(createWidget(TABLE_TEXT, 40).eq(createWidget(TABLE_TEXT, 120))).toBe(false);
        });
    });
});

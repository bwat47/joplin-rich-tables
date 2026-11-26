import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { linkOpenerFacet } from '../services/linkOpener';
import { buildFootnoteHref } from '../shared/footnoteAnchor';
import { getActiveCell } from '../tableState/activeCellState';
import { getCellSelection } from '../tableState/cellSelectionState';
import { NON_CANONICAL_DOC } from './interactiveTableTestHarness';
import {
    createEditorViewHarness,
    createResizeObserverStub,
    mountTableWidgetView,
    type MountedTableWidgetView,
    type TableWidgetViewOptions,
} from './tableEditorFixtures';

const resizeObserver = createResizeObserverStub();
const viewHarness = createEditorViewHarness();

function mountWidgetView(options?: Partial<TableWidgetViewOptions>): MountedTableWidgetView {
    return mountTableWidgetView(viewHarness, { doc: NON_CANONICAL_DOC, ...options });
}

beforeEach(() => {
    resizeObserver.install();
});

afterEach(() => {
    viewHarness.destroyViews();
    vi.restoreAllMocks();
});

describe('table widget interactions', () => {
    it('starts rectangular selection on shift-click from the active cell', () => {
        const { view, cells } = mountWidgetView({
            activeCell: {
                tableFrom: 0,
                section: 'header',
                row: 0,
                col: 0,
            },
        });
        const event = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            shiftKey: true,
        });

        cells.body1.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(getActiveCell(view.state)).toBeNull();
        expect(getCellSelection(view.state)).toEqual({
            tableFrom: 0,
            anchor: { section: 'header', row: 0, col: 0 },
            focus: { section: 'body', row: 0, col: 1 },
        });
    });

    it('clears an existing selection before activating a clicked cell', () => {
        const { view, cells } = mountWidgetView({
            cellSelection: {
                tableFrom: 0,
                anchor: { section: 'header', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            },
        });

        const event = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0,
        });

        cells.body0.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(getCellSelection(view.state)).toBeNull();
        expect(getActiveCell(view.state)).toMatchObject({
            section: 'body',
            row: 0,
            col: 0,
        });
    });

    it('opens external rendered links through the link opener facet', () => {
        const open = vi.fn();
        const { cells } = mountWidgetView({
            extensions: [
                linkOpenerFacet.of({
                    open,
                }),
            ],
        });
        const link = document.createElement('a');
        link.setAttribute('href', 'https://example.com');
        cells.body0.appendChild(link);
        const event = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            button: 0,
        });
        const stopPropagation = vi.spyOn(event, 'stopPropagation');

        link.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(open).toHaveBeenCalledWith('https://example.com');
        expect(stopPropagation).toHaveBeenCalled();
    });

    describe('internal anchor links', () => {
        // Fenced content deliberately shadows both targets so the scan must skip it.
        const ANCHOR_DOC = [
            '|H1|H2|',
            '|---|---|',
            '|a|b|',
            '',
            '```',
            '# Real Heading',
            '[^1]: decoy footnote',
            '```',
            '',
            '## Real Heading',
            '',
            '[^1]: actual footnote',
            '[^my note]: spaced footnote',
        ].join('\n');

        const posOfLine = (doc: string, line: string): number => doc.indexOf(`\n${line}`) + 1;

        function clickAnchorLink(href: string): {
            view: EditorView;
            dispatch: MockInstance<EditorView['dispatch']>;
            handled: boolean;
        } {
            const { view, cells } = mountWidgetView({ doc: ANCHOR_DOC });
            const dispatch = vi.spyOn(view, 'dispatch');
            const link = document.createElement('a');
            link.setAttribute('href', href);
            cells.body0.appendChild(link);
            const event = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                button: 0,
            });

            link.dispatchEvent(event);

            // CodeMirror calls `preventDefault` on an event whose handler returned true.
            return { view, dispatch, handled: event.defaultPrevented };
        }

        it('scrolls to the footnote definition outside fenced code', () => {
            const { dispatch, handled } = clickAnchorLink('#fn-1');

            expect(handled).toBe(true);
            expect(dispatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    selection: { anchor: posOfLine(ANCHOR_DOC, '[^1]: actual footnote') },
                    scrollIntoView: true,
                })
            );
        });

        it('decodes the label so footnotes with unsafe characters resolve', () => {
            const { dispatch, handled } = clickAnchorLink(buildFootnoteHref('my note'));

            expect(handled).toBe(true);
            expect(dispatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    selection: { anchor: posOfLine(ANCHOR_DOC, '[^my note]: spaced footnote') },
                })
            );
        });

        it('does not fall back to a heading when a footnote anchor has no definition', () => {
            const { dispatch, handled } = clickAnchorLink(buildFootnoteHref('missing'));

            expect(handled).toBe(true);
            expect(dispatch).not.toHaveBeenCalled();
        });

        it('scrolls to the heading whose slug matches the anchor', () => {
            const { dispatch, handled } = clickAnchorLink('#real-heading');

            expect(handled).toBe(true);
            expect(dispatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    selection: { anchor: posOfLine(ANCHOR_DOC, '## Real Heading') },
                    scrollIntoView: true,
                })
            );
        });

        it('consumes the click but does not scroll when the anchor resolves to nothing', () => {
            const { dispatch, handled } = clickAnchorLink('#no-such-heading');

            expect(handled).toBe(true);
            expect(dispatch).not.toHaveBeenCalled();
        });
    });
});

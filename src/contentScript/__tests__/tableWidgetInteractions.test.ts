import { describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { getActiveCell } from '../tableState/activeCellState';
import { getCellSelection, setCellSelectionEffect } from '../tableState/cellSelectionState';
import { handleTableInteraction } from '../tableWidget/tableWidgetInteractions';
import { linkOpenerFacet } from '../services/linkOpener';
import { buildFootnoteHref } from '../shared/footnoteAnchor';
import {
    createInteractiveTableHarness,
    getLastDispatchSpec,
    type MutableTestView,
} from './interactiveTableTestHarness';

describe('table widget interactions', () => {
    it('starts rectangular selection on shift-click from the active cell', () => {
        const { view, cells } = createInteractiveTableHarness({
            activeCell: {
                tableFrom: 0,
                section: 'header',
                row: 0,
                col: 0,
            },
        });
        const event = {
            type: 'mousedown',
            button: 0,
            shiftKey: true,
            target: cells.body1,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as unknown as MouseEvent;

        expect(handleTableInteraction(view, event)).toBe(true);
        expect(getActiveCell(view.state)).toBeNull();
        expect(getCellSelection(view.state)).toEqual({
            tableFrom: 0,
            anchor: { section: 'header', row: 0, col: 0 },
            focus: { section: 'body', row: 0, col: 1 },
        });
    });

    it('clears an existing selection before activating a clicked cell', () => {
        const { view, cells } = createInteractiveTableHarness();
        view.dispatch({
            effects: setCellSelectionEffect.of({
                tableFrom: 0,
                anchor: { section: 'header', row: 0, col: 0 },
                focus: { section: 'body', row: 0, col: 1 },
            }),
        });

        const event = {
            type: 'mousedown',
            button: 0,
            target: cells.body0,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as unknown as MouseEvent;

        expect(handleTableInteraction(view, event)).toBe(true);
        expect(getCellSelection(view.state)).toBeNull();
        expect(getActiveCell(view.state)).toMatchObject({
            section: 'body',
            row: 0,
            col: 0,
        });
    });

    it('opens external rendered links through the link opener facet', () => {
        const open = vi.fn();
        const { view } = createInteractiveTableHarness({
            extensions: [
                linkOpenerFacet.of({
                    open,
                }),
            ],
        });
        const widget = {};
        // This file runs in the `node` environment, so the anchor is stubbed.
        // It must mirror every DOM API the link handler reads: `dataset` for
        // Joplin's internal-link attributes, `getAttribute` for the href.
        const link = {
            dataset: {} as DOMStringMap,
            getAttribute: vi.fn((name: string) => (name === 'href' ? 'https://example.com' : null)),
        };
        const target = {
            closest: vi.fn((selector: string) => {
                if (selector === 'a') {
                    return link;
                }
                if (selector.includes('cm-table-widget')) {
                    return widget;
                }
                return null;
            }),
        };
        const event = {
            type: 'click',
            button: 0,
            target,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as unknown as MouseEvent;

        expect(handleTableInteraction(view, event)).toBe(true);
        expect(open).toHaveBeenCalledWith('https://example.com');
        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
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

        function clickAnchorLink(href: string): { view: EditorView; handled: boolean } {
            const { view } = createInteractiveTableHarness({ doc: ANCHOR_DOC });
            const widget = {};
            // This file runs in the `node` environment, so the anchor is stubbed.
            const link = {
                dataset: {} as DOMStringMap,
                getAttribute: vi.fn((name: string) => (name === 'href' ? href : null)),
            };
            const target = {
                closest: vi.fn((selector: string) => {
                    if (selector === 'a') {
                        return link;
                    }
                    if (selector.includes('cm-table-widget')) {
                        return widget;
                    }
                    return null;
                }),
            };
            const event = {
                type: 'click',
                button: 0,
                target,
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
            } as unknown as MouseEvent;

            return { view, handled: handleTableInteraction(view, event) };
        }

        it('scrolls to the footnote definition outside fenced code', () => {
            const { view, handled } = clickAnchorLink('#fn-1');

            expect(handled).toBe(true);
            expect(getLastDispatchSpec(view as unknown as MutableTestView)).toMatchObject({
                selection: { anchor: posOfLine(ANCHOR_DOC, '[^1]: actual footnote') },
                scrollIntoView: true,
            });
        });

        it('decodes the label so footnotes with unsafe characters resolve', () => {
            const { view, handled } = clickAnchorLink(buildFootnoteHref('my note'));

            expect(handled).toBe(true);
            expect(getLastDispatchSpec(view as unknown as MutableTestView)).toMatchObject({
                selection: { anchor: posOfLine(ANCHOR_DOC, '[^my note]: spaced footnote') },
            });
        });

        it('does not fall back to a heading when a footnote anchor has no definition', () => {
            const { view, handled } = clickAnchorLink(buildFootnoteHref('missing'));

            expect(handled).toBe(true);
            expect((view as unknown as MutableTestView).dispatch).not.toHaveBeenCalled();
        });

        it('scrolls to the heading whose slug matches the anchor', () => {
            const { view, handled } = clickAnchorLink('#real-heading');

            expect(handled).toBe(true);
            expect(getLastDispatchSpec(view as unknown as MutableTestView)).toMatchObject({
                selection: { anchor: posOfLine(ANCHOR_DOC, '## Real Heading') },
                scrollIntoView: true,
            });
        });

        it('consumes the click but does not scroll when the anchor resolves to nothing', () => {
            const { view, handled } = clickAnchorLink('#no-such-heading');

            expect(handled).toBe(true);
            expect((view as unknown as MutableTestView).dispatch).not.toHaveBeenCalled();
        });
    });
});

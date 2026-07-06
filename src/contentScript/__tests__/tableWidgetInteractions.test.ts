import { describe, expect, it, vi } from 'vitest';
import { getActiveCell } from '../tableState/activeCellState';
import { getCellSelection, setCellSelectionEffect } from '../tableState/cellSelectionState';
import { handleTableInteraction } from '../tableWidget/tableWidgetInteractions';
import { linkOpenerFacet } from '../services/linkOpener';
import { createInteractiveTableHarness } from './interactiveTableTestHarness';

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
        const link = {
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
});

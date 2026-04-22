/**
 * @jest-environment jsdom
 */

import { describe, expect, it, jest } from '@jest/globals';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { handleOutsideTableInteraction } from '../tableWidget/tableWidgetExtension';
import { activeCellField, setActiveCellEffect, type ActiveCell } from '../tableState/activeCellState';
import { cellSelectionField } from '../tableState/cellSelectionState';
import { CLASS_TABLE_WIDGET } from '../tableWidget/domHelpers';

interface MutableTestView {
    state: EditorState;
    dispatch: jest.Mock<(spec: TransactionSpec) => void>;
    focus: jest.Mock;
    plugin: jest.Mock;
    posAtCoords: jest.Mock;
    posAtDOM: jest.Mock;
    contentDOM: {
        querySelectorAll: jest.Mock;
    };
}

function createViewHarness(params?: { activeCell?: ActiveCell; widgetRect?: DOMRect }): {
    view: EditorView;
    widget: HTMLElement;
} {
    let currentState = EditorState.create({
        doc: ['| H1 | H2 |', '| --- | --- |', '| a1 | a2 |'].join('\n'),
        extensions: [activeCellField, cellSelectionField],
    });

    if (params?.activeCell) {
        currentState = currentState.update({ effects: setActiveCellEffect.of(params.activeCell) }).state;
    }

    const widget = document.createElement('div');
    widget.className = CLASS_TABLE_WIDGET;
    const rect =
        params?.widgetRect ??
        ({
            left: 20,
            top: 40,
            right: 220,
            bottom: 120,
            width: 200,
            height: 80,
            x: 20,
            y: 40,
            toJSON: () => ({}),
        } as DOMRect);
    widget.getBoundingClientRect = jest.fn(() => rect);

    const view: MutableTestView = {
        state: currentState,
        dispatch: jest.fn(),
        focus: jest.fn(),
        plugin: jest.fn(() => null),
        posAtCoords: jest.fn(() => 0),
        posAtDOM: jest.fn((node: unknown) => {
            if (node === widget) {
                return 0;
            }
            throw new Error('Unexpected DOM lookup');
        }),
        contentDOM: {
            querySelectorAll: jest.fn(() => [widget]),
        },
    };

    return { view: view as unknown as EditorView, widget };
}

describe('handleOutsideTableInteraction', () => {
    it('keeps the nested editor context when pressing the active table scrollbar area', () => {
        const { view } = createViewHarness({
            activeCell: {
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 0,
            },
        });

        const outsideTarget = document.createElement('div');
        const event = {
            target: outsideTarget,
            clientX: 210,
            clientY: 110,
        } as unknown as MouseEvent;

        expect(handleOutsideTableInteraction(view, event, { preserveContextMenu: false })).toBe(false);
        expect(view.dispatch).not.toHaveBeenCalled();
        expect(view.posAtCoords).not.toHaveBeenCalled();
    });

    it('still closes when the pointer is outside the active widget bounds', () => {
        const { view } = createViewHarness({
            activeCell: {
                tableFrom: 0,
                section: 'body',
                row: 0,
                col: 0,
            },
        });

        const outsideTarget = document.createElement('div');
        const event = {
            target: outsideTarget,
            clientX: 260,
            clientY: 130,
        } as unknown as MouseEvent;

        expect(handleOutsideTableInteraction(view, event, { preserveContextMenu: false })).toBe(true);
        expect(view.dispatch).toHaveBeenCalledTimes(1);
        expect(view.posAtCoords).toHaveBeenCalledWith({ x: 260, y: 130 });
        expect(view.focus).toHaveBeenCalledTimes(1);
    });
});
